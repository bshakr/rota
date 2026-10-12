require "puma/plugin"
require_relative "../solid_queue_watchdog"

# Solid Queue as threads inside Puma. Replaces the gem's `plugin :solid_queue` + `solid_queue_mode
# :async`, which (in solid_queue 1.4.0) starts a fresh supervisor in before_restart that the exec a
# moment later kills mid-job, and has nothing watching for the supervisor thread dying.
#
# Loaded before the app, so SolidQueue and Rails are only referenced inside the event blocks.
Puma::Plugin.create do
  def start(launcher)
    @log_writer = launcher.log_writer

    launcher.events.after_booted { start_queue }
    launcher.events.after_stopped { stop_queue }
    # Stop only: the exec that follows boots a new process, which starts its own supervisor.
    launcher.events.before_restart { stop_queue }
  end

  private

  def start_queue
    @supervisor = SolidQueue::Supervisor.start(mode: :async, standalone: false)
    @watchdog = SolidQueueWatchdog.new(@supervisor, log: ->(message) { @log_writer.log(message) })
    @watchdog.start
  end

  def stop_queue
    @watchdog&.stop
    @supervisor&.stop
  rescue Exception => e # rubocop:disable Lint/RescueException
    # A supervisor thread that died re-raises its error from #join; shutdown must carry on regardless.
    @log_writer.log("Solid Queue stopped with #{e.class}: #{e.message}")
  end
end
