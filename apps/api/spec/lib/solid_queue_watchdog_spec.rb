require "rails_helper"
require Rails.root.join("lib/puma/solid_queue_watchdog").to_s

RSpec.describe SolidQueueWatchdog do
  let(:live_thread) { instance_double(Thread, alive?: true) }
  let(:dead_thread) { instance_double(Thread, alive?: false) }
  let(:children) { { 1 => double(alive?: true), 2 => double(alive?: true) } }
  let(:supervisor) { SolidQueue::AsyncSupervisor.allocate }
  let(:logged) { [] }
  let(:terminations) { [] }
  let(:hard_exits) { [] }
  let(:watchdog) do
    described_class.new(supervisor, log: ->(message) { logged << message },
      terminate: -> { terminations << :term }, hard_exit: -> { hard_exits << :exit! })
  end

  before do
    supervisor.instance_variable_set(:@thread, live_thread)
    allow(supervisor).to receive(:process_instances).and_return(children)
    allow(watchdog).to receive(:sleep)
    allow(Rails.error).to receive(:report)
  end

  # It reads @thread and #process_instances, which are not public API.
  it "is checked against the Solid Queue version it was written for" do
    expect(SolidQueue::VERSION).to eq("1.4.0"),
      "re-check SolidQueueWatchdog#health against the new AsyncSupervisor, then update this version"
    expect(SolidQueue::AsyncSupervisor.private_method_defined?(:process_instances)).to be(true)
  end

  it "terminates Puma, reports and logs as soon as the supervisor thread is dead" do
    supervisor.instance_variable_set(:@thread, dead_thread)

    watchdog.run

    expect(terminations).to eq([ :term ])
    expect(logged.first).to include("supervisor thread died")
    expect(Rails.error).to have_received(:report).with(an_instance_of(RuntimeError), hash_including(handled: false))
  end

  it "exits hard if TERM has not ended the process within the grace period" do
    supervisor.instance_variable_set(:@thread, dead_thread)

    watchdog.run

    expect(watchdog).to have_received(:sleep).with(described_class::EXIT_GRACE)
    expect(hard_exits).to eq([ :exit! ])
  end

  it "tolerates a dead child thread the supervisor is about to replace" do
    flaky = double
    allow(flaky).to receive(:alive?).and_return(false, true, false, true)
    children[2] = flaky
    checks = 0
    allow(watchdog).to receive(:sleep) { watchdog.stop if (checks += 1) > 4 }

    watchdog.run

    expect(terminations).to be_empty
  end

  it "terminates Puma when a child thread stays dead" do
    children[2] = double(alive?: false)

    watchdog.run

    expect(terminations).to eq([ :term ])
    expect(logged.first).to include("stayed dead for #{described_class::STRIKES} checks")
  end

  it "does nothing once stopped, so a deliberate shutdown is not mistaken for a death" do
    supervisor.instance_variable_set(:@thread, dead_thread)
    allow(watchdog).to receive(:sleep) { watchdog.stop }

    watchdog.run

    expect(terminations).to be_empty
    expect(Rails.error).not_to have_received(:report)
  end
end
