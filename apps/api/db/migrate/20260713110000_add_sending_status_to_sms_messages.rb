# A fourth waypoint between `pending` and `sent`: `sending`.
#
# SendSmsJob claims a row by moving it pending -> sending in one atomic UPDATE before it calls
# Twilio, and moves it sending -> sent only after the carrier has accepted the message. A process
# killed between those two points (a redeploy, an OOM) leaves the row in `sending`, never back in
# `pending` — so the job that Solid Queue re-runs cannot claim it again and cannot send a second,
# unrecallable text. A `sending` row is a "needs investigation" state, which is strictly better
# than a duplicate SMS.
class AddSendingStatusToSmsMessages < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :sms_messages, name: "sms_messages_status_known"
    add_check_constraint :sms_messages, "status IN ('pending', 'sending', 'sent', 'delivered', 'failed')",
      name: "sms_messages_status_known"
  end

  def down
    remove_check_constraint :sms_messages, name: "sms_messages_status_known"
    add_check_constraint :sms_messages, "status IN ('pending', 'sent', 'delivered', 'failed')",
      name: "sms_messages_status_known"
  end
end
