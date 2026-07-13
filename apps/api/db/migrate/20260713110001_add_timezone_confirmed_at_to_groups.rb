# A group JIT-provisioned from a WorkOS token is created with a UTC timezone, because the token
# carries no timezone — a guess. groups.timezone drives send_hour for every reminder, so an
# unconfirmed guess is a silent product bug (a London house texts an hour early once BST begins).
#
# This column records whether a human has ever confirmed the timezone. NULL means "we guessed";
# it is stamped only when an admin sets the timezone through the settings API (BLO-1047), never on
# JIT insert. While NULL, the dashboard warns (BLO-1053).
class AddTimezoneConfirmedAtToGroups < ActiveRecord::Migration[8.1]
  def change
    add_column :groups, :timezone_confirmed_at, :datetime, null: true
  end
end
