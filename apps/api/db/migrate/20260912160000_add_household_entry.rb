class AddHouseholdEntry < ActiveRecord::Migration[8.1]
  def up
    add_column :groups, :slug, :string
    # Stable existing-house links; no application callbacks in a historical migration.
    select_all("SELECT id, name FROM groups").each do |group|
      base = group["name"].parameterize.gsub(/[^a-z0-9]+/, "-").first(60).gsub(/\A-+|-+\z/, "").presence || "household"
      execute "UPDATE groups SET slug = #{connection.quote("#{base}-#{group['id']}")} WHERE id = #{Integer(group['id'])}"
    end
    change_column_null :groups, :slug, false
    # The previous API release can still provision a group during a rolling deploy.
    change_column_default :groups, :slug, -> { "'household-' || substr(md5(random()::text), 1, 16)" }
    add_index :groups, :slug, unique: true

    change_column_null :sms_messages, :shift_id, true
    remove_check_constraint :sms_messages, name: "sms_messages_kind_known"
    add_check_constraint :sms_messages, "kind IN ('reminder', 'cover_notice', 'member_login')", name: "sms_messages_kind_known"
    add_check_constraint :sms_messages,
      "(kind = 'member_login' AND shift_id IS NULL AND days_before IS NULL) OR (kind <> 'member_login' AND shift_id IS NOT NULL)",
      name: "sms_messages_shift_for_kind"
    add_index :sms_messages, :created_at, where: "kind = 'member_login'", name: "index_sms_messages_on_login_time"
  end

  def down
    # Login delivery history must not be silently discarded to roll a release back.
    raise ActiveRecord::IrreversibleMigration, "Contains household links and login SMS history; roll forward instead"
  end
end
