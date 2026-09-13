# What a text cost, recorded on the row that spent the money (BLO-1672).
#
# Two figures, arriving at two different times. `num_segments` comes back in Twilio's create
# response the moment a message is accepted, and is the estimate the spend page shows until the real
# charge lands. `price` settles minutes after delivery and is never in that response at all — it has
# to be asked for afterwards, which is what BackfillSmsPricesJob does nightly.
#
# `price_fetched_at` is the "we asked" flag, not the "we were charged" one. NULL means nobody has
# asked Twilio about this row yet; set with `price` still NULL means Twilio has no record of the
# message (past its ~13-month retention), which reads as "no figure", never as "free".
#
# Every column is additive and nullable, so the currently deployed code keeps running against this
# schema unchanged — see the plan's Rollout step 1.
class AddUsageToSmsMessages < ActiveRecord::Migration[8.1]
  def change
    add_column :sms_messages, :num_segments, :integer
    # Five decimal places because a single segment is priced in hundredths of a cent ("-0.00790").
    add_column :sms_messages, :price, :decimal, precision: 10, scale: 5
    add_column :sms_messages, :price_unit, :string, limit: 3
    add_column :sms_messages, :price_fetched_at, :datetime

    # Spend and traffic both ask "what happened in this window" across every kind of text. The only
    # created_at index today is partial to member_login, so those queries have nothing to use.
    add_index :sms_messages, :created_at
  end
end
