# When a send failed in a way that leaves it unknown whether Twilio accepted it. Set, the next
# attempt asks Twilio before posting again.
class AddAmbiguousAttemptAtToSmsMessages < ActiveRecord::Migration[8.1]
  def change
    add_column :sms_messages, :ambiguous_attempt_at, :datetime
  end
end
