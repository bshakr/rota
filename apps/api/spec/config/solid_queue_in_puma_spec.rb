require "rails_helper"
require "puma"
require "puma/configuration"
require Rails.root.join("lib/puma/plugin/solid_queue_async").to_s

RSpec.describe "Solid Queue inside Puma" do
  def with_env(vars)
    saved = vars.keys.index_with { |key| ENV[key] }
    vars.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    yield
  ensure
    saved.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  def puma_config(env)
    with_env(env) do
      Puma::Configuration.new({}, { config_files: [ Rails.root.join("config/puma.rb").to_s ] }).tap(&:clamp)
    end
  end

  def puma_options(env)
    puma_config(env).options
  end

  def queue_plugins(env)
    puma_config(env).plugins.instance_variable_get(:@instances).select { |plugin| plugin.class == Puma::Plugins.find("solid_queue_async") }
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

  it "loads the in-process Solid Queue plugin when SOLID_QUEUE_IN_PUMA is set" do
    expect(queue_plugins("SOLID_QUEUE_IN_PUMA" => "1").size).to eq(1)
  end

  it "loads no Solid Queue plugin without SOLID_QUEUE_IN_PUMA" do
    expect(queue_plugins("SOLID_QUEUE_IN_PUMA" => nil)).to be_empty
  end

  describe "the plugin's lifecycle" do
    let(:events) { Puma::Events.new }
    let(:launcher) { Struct.new(:events, :log_writer).new(events, Puma::LogWriter.null) }
    let(:supervisor) { instance_double(SolidQueue::AsyncSupervisor, stop: nil) }
    let(:watchdog) { instance_double(SolidQueueWatchdog, start: nil, stop: nil) }

    before do
      allow(SolidQueue::Supervisor).to receive(:start).and_return(supervisor)
      allow(SolidQueueWatchdog).to receive(:new).and_return(watchdog)
      queue_plugins("SOLID_QUEUE_IN_PUMA" => "1").first.start(launcher)
      events.fire_after_booted!
    end

    it "starts one async supervisor, watched, once Puma has booted" do
      expect(SolidQueue::Supervisor).to have_received(:start).with(mode: :async, standalone: false).once
      expect(SolidQueueWatchdog).to have_received(:new).with(supervisor, log: anything)
      expect(watchdog).to have_received(:start)
    end

    # A supervisor started here would be killed mid-job by the exec that follows.
    it "stops the supervisor on a hot restart and starts no replacement" do
      events.fire_before_restart!

      expect(watchdog).to have_received(:stop).ordered
      expect(supervisor).to have_received(:stop).ordered
      expect(SolidQueue::Supervisor).to have_received(:start).once
    end

    it "stops the watchdog before the supervisor on a normal stop" do
      events.fire_after_stopped!

      expect(watchdog).to have_received(:stop).ordered
      expect(supervisor).to have_received(:stop).ordered
    end

    it "carries on stopping when the dead supervisor's thread re-raises its error" do
      allow(supervisor).to receive(:stop).and_raise(ActiveRecord::ConnectionNotEstablished)

      expect { events.fire_after_stopped! }.not_to raise_error
    end
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
