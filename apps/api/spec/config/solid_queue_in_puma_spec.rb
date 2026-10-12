require "rails_helper"
require "puma"
require "puma/configuration"

RSpec.describe "Solid Queue inside Puma" do
  def with_env(vars)
    saved = vars.keys.index_with { |key| ENV[key] }
    vars.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    saved.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  def puma_options(env)
    with_env(env) do
      config = Puma::Configuration.new({}, { config_files: [ Rails.root.join("config/puma.rb").to_s ] })
      config.clamp
      config.options
    end
  end

  def database_configs(env)
    with_env(env) do
      yaml = ERB.new(Rails.root.join("config/database.yml").read).result
      ActiveRecord::DatabaseConfigurations.new(YAML.safe_load(yaml, aliases: true))
    end
  end

  def max_connections(configs, env_name, name)
    configs.configs_for(env_name: env_name, name: name).configuration_hash.fetch(:max_connections).to_i
  end

  # Every thread in one process that can hold a queue-database connection at the same moment,
  # counted from the configuration Solid Queue itself will run.
  def solid_queue_connection_holders(env)
    with_env(env) do
      processes = SolidQueue::Configuration.new(mode: :async, standalone: false).configured_processes
      job_threads = processes.select { |process| process.kind == :worker }.sum { |process| process.attributes.fetch(:threads) }
      dispatchers = processes.count { |process| process.kind == :dispatcher }
      pollers = processes.size
      heartbeats = processes.size + 1 # the supervisor heartbeats too
      supervisor_maintenance = 1
      recurring_fires_at_once = 2 # reminder_sweep and top_up_shift_windows both fire at 3:00

      { job_threads:, solid_queue_own: pollers + heartbeats + supervisor_maintenance + dispatchers + recurring_fires_at_once }
    end
  end

  it "runs the supervisor as threads in the Puma process when SOLID_QUEUE_IN_PUMA is set" do
    expect(puma_options("SOLID_QUEUE_IN_PUMA" => "1")[:solid_queue_mode]).to eq(:async)
  end

  it "loads no Solid Queue plugin without SOLID_QUEUE_IN_PUMA" do
    expect(puma_options("SOLID_QUEUE_IN_PUMA" => nil)[:solid_queue_mode]).to be_nil
  end

  [ nil, "3", "10" ].each do |rails_max_threads|
    context "with RAILS_MAX_THREADS=#{rails_max_threads.inspect}" do
      let(:env) { { "SOLID_QUEUE_IN_PUMA" => "1", "RAILS_MAX_THREADS" => rails_max_threads } }
      let(:web_threads) { puma_options(env)[:max_threads].to_i }
      let(:holders) { solid_queue_connection_holders(env) }
      let(:configs) { database_configs(env) }

      %w[development test production].each do |env_name|
        it "sizes the #{env_name} queue pool for web, job and Solid Queue threads together" do
          expect(max_connections(configs, env_name, "queue"))
            .to be >= web_threads + holders[:job_threads] + holders[:solid_queue_own]
        end

        it "sizes the #{env_name} primary pool for web and job threads together" do
          expect(max_connections(configs, env_name, "primary")).to be >= web_threads + holders[:job_threads]
        end
      end
    end
  end
end
