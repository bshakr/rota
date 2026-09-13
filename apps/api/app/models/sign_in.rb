# One sign-in, recorded by the AuthKit callback through Api::SignInsController.
#
# It is a table and not a `users.last_sign_in_at` column because the questions the super admin
# dashboards ask are about history: weekly active admins, returning users, how many times somebody
# signed in before they ever made a house, and how long it took them. A single column answers only
# the last of those, and only badly.
#
# There is deliberately no uniqueness validation on `jti`. The unique index is the referee, exactly
# as it is for the provisioned rows, and the controller rescues the collision — so the common case
# (a sign-in nobody has recorded yet) costs one INSERT and no SELECT to prove the obvious.
class SignIn < ApplicationRecord
  belongs_to :user
end
