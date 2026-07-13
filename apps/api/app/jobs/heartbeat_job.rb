# The trivial job CI uses to prove a Solid Queue worker actually starts and drains the
# queue. script/solid_queue_smoke.rb enqueues one and waits for it to finish, so deleting
# this class breaks the "solid queue" CI step.
class HeartbeatJob < ApplicationJob
  queue_as :default

  def perform(token = "heartbeat")
    Rails.logger.info("HeartbeatJob processed #{token}")
    token
  end
end
