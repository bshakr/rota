# Proves end to end that a Solid Queue worker picks a job off the queue and finishes it.
# Needs a worker running against the same database:
#
#   bin/jobs &
#   bin/rails runner script/solid_queue_smoke.rb
#
# Exits non-zero if nothing drains the queue, which is what makes it useful in CI.

if ActiveJob::Base.queue_adapter_name.to_s != "solid_queue"
  abort "Expected the solid_queue adapter, got #{ActiveJob::Base.queue_adapter_name.inspect}. " \
        "Run this against an environment that uses Solid Queue (development or production)."
end

timeout = Integer(ENV.fetch("SMOKE_TIMEOUT_SECONDS", "60"))
job = HeartbeatJob.perform_later("smoke-#{SecureRandom.hex(4)}")
deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout

puts "Enqueued HeartbeatJob #{job.job_id}; waiting up to #{timeout}s for a worker..."

loop do
  record = SolidQueue::Job.find_by(active_job_id: job.job_id)

  if record&.finished_at
    puts "Worker finished #{record.class_name} #{job.job_id} at #{record.finished_at.iso8601}"
    exit 0
  end

  if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
    abort "No worker finished HeartbeatJob #{job.job_id} within #{timeout}s. Is bin/jobs running?"
  end

  sleep 0.25
end
