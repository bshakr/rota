module SuperAdmin
  # The pill on every row of the groups list, and the same pill on the group page header.
  #
  # One definition, in one place, because the list *filters* on it too. A pill that said "Quiet"
  # and a filter that disagreed would be worse than having no filter at all: the operator would be
  # reading a list that does not contain the house they went looking for.
  #
  # The order below is the precedence, and it is deliberate. Suspended first because it is a thing
  # somebody did, not a thing that happened. Then "never started", because a house with no running
  # rota is not quiet — it never began, which is a different conversation and a different fix.
  class GroupStatus
    # A month with nothing at all — no text, and (once BLO-1671 lands) nobody opening anything. A
    # week would flag every house that skips a bin collection; a quarter would notice a dead house
    # long after it stopped being recoverable.
    QUIET_AFTER = 30.days

    LIVE = "live".freeze
    QUIET = "quiet".freeze
    NEVER_STARTED = "never_started".freeze
    SUSPENDED = "suspended".freeze

    ALL = [ LIVE, QUIET, NEVER_STARTED, SUSPENDED ].freeze

    def self.of(group, stats, now: Time.current)
      return SUSPENDED if suspended?(group)
      # "Nobody is on any rota", not "nothing is switched on". A house that ran for a year and then
      # paused its rotas has started, whatever it is doing now; calling that "never started" would
      # put the label next to a year of its own traffic.
      return NEVER_STARTED if stats.staffed_rotas.zero?
      return QUIET if quiet?(group, stats, now)

      LIVE
    end

    # The seam for https://linear.app/bloombase/issue/BLO-1675, which adds `groups.suspended_at`
    # and the actions that set it. Until that migration lands there is no column to read, so no
    # house can be suspended and this arm is unreachable — asking the record whether it has the
    # attribute means the pill starts working the moment the column exists, rather than needing
    # this file edited again in the ticket that adds it.
    def self.suspended?(group)
      group.respond_to?(:suspended_at) && group.suspended_at.present?
    end
    private_class_method :suspended?

    # Silence is measured from the last thing that happened, and for a house where nothing has
    # happened yet, from the day it was created. Measuring from the beginning of time instead would
    # stamp "Quiet" on a house made ten minutes ago — the one house on the list where the operator
    # most needs to see that onboarding is still in progress.
    def self.quiet?(group, stats, now)
      since = stats.last_activity_at || group.created_at
      return false if since.nil?

      since < now - QUIET_AFTER
    end
    private_class_method :quiet?
  end
end
