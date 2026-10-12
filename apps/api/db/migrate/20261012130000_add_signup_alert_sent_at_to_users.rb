# NewSignupAlertJob claims the alert here before texting, so a job run twice texts once.
class AddSignupAlertSentAtToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :signup_alert_sent_at, :datetime
  end
end
