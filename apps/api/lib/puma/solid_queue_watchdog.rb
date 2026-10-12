# Ends the Puma process when Solid Queue (running as threads inside it) has died, so launchd or
# Railway restarts it. Without this a dead supervisor leaves Puma serving, /up green, and no job
# ever running again.
#
# Reads two private parts of SolidQueue::AsyncSupervisor 1.4.0 (@thread, #process_instances);
# spec/lib/solid_queue_watchdog_spec.rb pins the version so an upgrade makes someone re-check them.
class SolidQueueWatchdog
  INTERVAL = 2 # seconds between checks
  # A dead worker, dispatcher or scheduler thread is replaced by the supervisor's own 1 s loop, so
  # only one that stays dead this many checks in a row counts.
  STRIKES = 3
  # TERM drains requests and waits for jobs; if that has not ended the process by now, exit!.
  EXIT_GRACE = 60

  def initialize(supervisor, log:, terminate: -> { Process.kill(:TERM, Process.pid) }, hard_exit: -> { exit!(1) })
    @supervisor = supervisor
    @log = log
    @terminate = terminate
    @hard_exit = hard_exit
    @stopped = false
  end

  def start
    @thread = Thread.new do
      Thread.current.name = "solid_queue_watchdog"
      run
    end
  end

  def stop
    @stopped = true
  end

  def stopped?
    @stopped
  end

  def run
    misses = 0

    until stopped?
      sleep INTERVAL
      break if stopped?

      case health
      when :ok
        misses = 0
      when :dead
        return fail!("Solid Queue supervisor thread died; stopping Puma so it is restarted")
      when :degraded
        misses += 1
        return fail!("Solid Queue threads stayed dead for #{misses} checks; stopping Puma so it is restarted") if misses >= STRIKES
      end
    end
  end

  def health
    return :dead unless @supervisor.instance_variable_get(:@thread)&.alive?

    @supervisor.send(:process_instances).values.all?(&:alive?) ? :ok : :degraded
  end

  private

  def fail!(message)
    @log.call(message)
    report(message)
    @terminate.call
    sleep EXIT_GRACE
    @hard_exit.call
  end

  def report(message)
    Rails.error.report(RuntimeError.new(message), handled: false, source: "rotamonster.queue")
  rescue StandardError => e
    @log.call("Could not report the dead queue: #{e.class}: #{e.message}")
  end
end
