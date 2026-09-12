# Run with RAILS_ENV=test bin/rails runner script/household_entry_migration_smoke.rb.
# Uses its own throwaway database so it never resets another worktree's test data.
abort "Test environment required" unless Rails.env.test?
original = ActiveRecord::Base.connection_db_config.configuration_hash
database = "houserota_entry_#{SecureRandom.hex(6)}_test"
ActiveRecord::Base.connection.create_database(database)
begin
  ActiveRecord::Base.establish_connection(original.merge(database: database, max_connections: 8))
  migrations = ActiveRecord::MigrationContext.new(Rails.root.join("db/migrate"))
  migrations.migrate(20260713110001)
  connection = ActiveRecord::Base.connection
  [ "Park Vista", "Park Vista", "___", "🏠", "org_01EXAMPLE" ].each_with_index do |name, index|
    connection.execute("INSERT INTO groups (name, timezone, workos_organization_id, created_at, updated_at) VALUES (#{connection.quote(name)}, 'UTC', 'org_#{index}', NOW(), NOW())")
  end
  migrations.migrate
  slugs = connection.select_values("SELECT slug FROM groups")
  abort "Invalid backfill" unless slugs.uniq.length == 5 && slugs.all? { |slug| slug.match?(/\A[a-z0-9]+(?:-[a-z0-9]+)*\z/) }
  # A previous-version API INSERT (no slug field) must still work during deploy.
  connection.execute("INSERT INTO groups (name, timezone, workos_organization_id, created_at, updated_at) VALUES ('Rolling deploy', 'UTC', 'org_rolling', NOW(), NOW())")
  abort "Missing rolling-deploy default" unless connection.select_value("SELECT slug FROM groups WHERE workos_organization_id = 'org_rolling'").start_with?("household-")
  group = Group.first
  group.members.create!(name: "Concurrency test", phone_e164: "+447400000001")
  # Rails runner holds the loader interlock; load classes before joining workers.
  Rails.application.eager_load!
  threads = 5.times.map do
    Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        HouseholdEntry.request_link(slug: group.slug, phone: "+447400000001")
      end
    end
  end
  threads.each(&:value)
  abort "Concurrent requests sent duplicate links" unless SmsMessage.member_login.count == 1
  File.open(Rails.root.join("db/schema.rb"), "w") do |file|
    ActiveRecord::SchemaDumper.dump(ActiveRecord::Base.connection_pool, file)
  end
  puts "Household migration, duplicate-name backfill, rolling-deploy insert and concurrent login claims passed. Schema regenerated."
ensure
  ActiveRecord::Base.establish_connection(original)
  ActiveRecord::Base.connection.drop_database(database)
end
