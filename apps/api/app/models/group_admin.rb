# An admin's access to a group. Deliberately not called a "membership": with participants called
# Members, that word would be ambiguous. A *member* only ever means "a person who takes turns".
class GroupAdmin < ApplicationRecord
  belongs_to :user
  belongs_to :group

  # WorkOS owns the role vocabulary (its organization role slug), so it is stored, not policed.
  validates :role, presence: true
  validates :user_id, uniqueness: { scope: :group_id }
end
