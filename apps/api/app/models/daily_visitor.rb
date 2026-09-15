# Has this browser been here yet today? One row per browser per day, and it is gone within two.
#
# The web app turns each landing view into a DAILY VISITOR CODE — sixty-four characters of hex,
# hashed from the visit's network address and its browser string together with a salt derived from
# the shared secret and the UTC date (apps/web/src/app/api/analytics/route.ts). The code arrives in
# the `X-Analytics-Visitor` header, never in the event's properties, and this table is the only
# place it is ever written.
#
# The one question it answers is `claim`: was this the first time today? The answer becomes
# `first_visit_today` on the landing view, which is what makes "1,420 views from 887 browsers"
# countable. Nothing else reads a row, ever.
#
# THREE THINGS THIS CANNOT DO, each of them by construction rather than by policy:
#
#   Name anybody. A SHA-256 of an address, an agent and a secret cannot be turned back into any of
#   the three. Guessing it needs the secret as well as the address.
#
#   Follow anybody across a midnight. The salt is derived from the DATE and is never stored, so
#   yesterday's code cannot be recomputed today by us or by anybody holding this table. That is why
#   this product publishes no "returning visitors" figure and cannot be asked to.
#
#   Be joined to a visit. There is no foreign key here and no visitor column on analytics_events. A
#   row here says "some browser was here on the 15th" and a row there says "a visit happened, and it
#   was that browser's first today"; there is nothing to put the two together with.
#
# And it is deleted. RETENTION below is the rule, `prune` is the method, and the `prune_analytics`
# entry in config/recurring.yml is what actually runs it — the privacy page promises a day, so this
# is one of the few places in this codebase where a scheduler entry is part of the feature rather
# than housekeeping.
class DailyVisitor < ApplicationRecord
  # As the web app sends it: lowercase hex, SHA-256's own length. Anything else did not come from
  # that function, so the controller drops it and the visit is simply counted without a visitor.
  # Anchored with \A and \z rather than ^ and $, which in Ruby match either side of a NEWLINE and
  # would let sixty-four good characters on the first line carry anything at all on the second.
  DIGEST = /\A[0-9a-f]{64}\z/

  # How long a code is kept: the day it belongs to, and the day after. One whole day of slack past
  # the point the code stopped meaning anything, so a pruner that missed a night still leaves a
  # table holding nothing older than the privacy page's promise.
  #
  # It could be shorter. It must not be longer: every extra day is a day of codes that are useless
  # for counting and are nonetheless sitting there.
  RETENTION = 1

  class << self
    # Claim today for this code. True when the row was taken here, false when it was already held.
    #
    # `insert_all` with `unique_by` is ON CONFLICT DO NOTHING against the unique index, so two
    # requests racing on the same browser and the same day cannot both be told "first": one insert
    # takes the row and the other returns nothing. Doing this as `exists?` then `create` would
    # count a visitor twice on a double-tap, which is the one error this table exists to avoid.
    #
    # The claim happens BEFORE the event is written, so an event that then fails to validate has
    # still spent the claim and the next visit reads false. That direction is deliberate: the cost
    # is one uncounted visitor, and the other way round would be one browser counted twice.
    def claim(digest, day: Date.current)
      return nil unless digest.is_a?(String) && digest.match?(DIGEST)

      insert_all([ { day: day, digest: digest } ], unique_by: %i[day digest]).length.positive?
    end

    # Everything older than the day before today, UTC. Returns how many rows went.
    #
    # `Date.current` rather than a local date: the salt these codes were made with is keyed on the
    # UTC date, so UTC is the only calendar a row here has.
    def prune(now: Time.current)
      where(day: ...(now.utc.to_date - RETENTION)).delete_all
    end
  end
end
