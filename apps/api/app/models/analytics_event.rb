# One thing that happened, and nothing about who it happened to.
#
# This is the whole analytics store. There is no third party, no SDK, no script in the page, and no
# visitor identity: no device id, no session id, no analytics cookie. What is kept is a name from a
# fixed allowlist, a house when the event belongs to one, and a small bag of allowlisted properties.
# The funnel is therefore counted in aggregate and can never be replayed as one person's journey,
# which is a deliberate limit rather than a missing feature — and it is why the site needs no consent
# banner.
#
# Two halves, and the split is a security boundary rather than a category:
#
#   ANONYMOUS_NAMES  happen before a house exists, so they carry no group. Four of them, and they are
#                    the ONLY names the HTTP endpoint will accept, because a browser can post to it.
#   GROUP_NAMES      happen inside the product, are written in-process by Rails, and always name a
#                    house. A visitor must never be able to forge one: "this house got a text
#                    delivered" is the number the whole funnel is for.
#
# Each group event fires the FIRST time it can be true for a house. "First" is an existence check at
# the call site — the absence of a rota, of a member, of a calendar connection, a NULL
# `timezone_confirmed_at`, a conditional UPDATE on `members.first_opened_at` — never a bookkeeping
# column per event.
class AnalyticsEvent < ApplicationRecord
  # Before a house exists.
  LANDING_VIEW = "landing_view"
  CTA_CLICK = "cta_click"
  SIGNIN_STARTED = "signin_started"
  SIGNIN_COMPLETED = "signin_completed"

  # After it does.
  HOUSE_NAMED = "house_named"
  FIRST_ROTA_SAVED = "first_rota_saved"
  FIRST_MEMBER_ADDED = "first_member_added"
  FIRST_TEXT_DELIVERED = "first_text_delivered"
  FIRST_MEMBER_LINK_OPENED = "first_member_link_opened"
  CALENDAR_CONNECTED = "calendar_connected"

  ANONYMOUS_NAMES = [ LANDING_VIEW, CTA_CLICK, SIGNIN_STARTED, SIGNIN_COMPLETED ].freeze
  GROUP_NAMES = [ HOUSE_NAMED, FIRST_ROTA_SAVED, FIRST_MEMBER_ADDED, FIRST_TEXT_DELIVERED,
                  FIRST_MEMBER_LINK_OPENED, CALENDAR_CONNECTED ].freeze
  NAMES = (ANONYMOUS_NAMES + GROUP_NAMES).freeze

  # The steps, in the order a house walks them. `calendar_connected` is deliberately NOT in here: it
  # is a side branch off `house_named`, not a step between two others, and putting it in the sequence
  # would make every conversion after it read as a collapse.
  FUNNEL = [ LANDING_VIEW, CTA_CLICK, SIGNIN_STARTED, SIGNIN_COMPLETED, HOUSE_NAMED,
             FIRST_ROTA_SAVED, FIRST_MEMBER_ADDED, FIRST_TEXT_DELIVERED, FIRST_MEMBER_LINK_OPENED ].freeze

  # Every property any event may carry, and there will never be one that is not on this list. A
  # campaign label, a CTA position, a path, and the member id that makes "two housemates opened"
  # countable. No names, no phone numbers, no tokens, no calendar URLs, no free text.
  PROPERTY_KEYS = %w[position path ref utm_source utm_medium utm_campaign utm_content member_id].freeze

  # Long enough for any real campaign name, short enough that the column can never become storage.
  MAX_VALUE_LENGTH = 200

  # The homepage has exactly three calls to action.
  CTA_POSITIONS = %w[hero closing header].freeze

  # How long an anonymous event is kept. A house's own events are kept for as long as the house is.
  #
  # A hundred and eighty days, because the super admin traffic page offers a 90-day window and
  # pruning at 90 clipped the far edge of it: the oldest bucket of the longest range was already
  # losing rows to the pruner while the page was still drawing it. Twice the longest window leaves
  # room for that range to be read in full, and for this year's figure to be held against last
  # quarter's, without the table ever becoming a place anybody could look somebody up — there is
  # nothing in a row to look up with.
  ANONYMOUS_RETENTION = 180.days

  belongs_to :group, optional: true

  validates :name, presence: true, inclusion: { in: NAMES }
  validates :occurred_at, presence: true
  validate :group_matches_name

  scope :named, ->(name) { where(name: name) }
  scope :anonymous, -> { where(group_id: nil) }
  scope :since, ->(time) { where(occurred_at: time..) }

  class << self
    # The one way an event is written, and it NEVER raises into its caller. A capture sits inside a
    # request that was otherwise about to succeed: adding a housemate must not become a 500 because
    # an analytics row would not validate. A dropped event is a warning in the log and a gap in a
    # chart, which is the correct relative cost.
    #
    # Returns true when a row was written, false when it was not, so a spec can tell the difference.
    def record(name, group: nil, occurred_at: nil, **properties)
      create!(
        name: name.to_s,
        group: group,
        occurred_at: occurred_at || Time.current,
        properties: sanitise_properties(properties)
      )
      true
    rescue StandardError => e
      Rails.logger.warn("[analytics] dropped #{name}: #{e.class}: #{e.message}")
      false
    end

    # Allowlist in, allowlist out. Anything not named here is discarded rather than rejected: losing
    # one property is better than losing the event that carried it.
    def sanitise_properties(raw)
      hash = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw
      return {} unless hash.respond_to?(:[])

      PROPERTY_KEYS.each_with_object({}) do |key, out|
        value = clean_value(hash[key].nil? ? hash[key.to_sym] : hash[key])
        out[key] = value unless value.nil?
      end
    end

    # Anonymous events age out; a house's own history does not, because it is the house's history.
    # Returns how many rows went.
    def prune_anonymous(older_than: ANONYMOUS_RETENTION, now: Time.current)
      anonymous.where(occurred_at: ...(now - older_than)).delete_all
    end

    private

    def clean_value(value)
      case value
      when String then value.strip[0, MAX_VALUE_LENGTH].presence
      when Integer, true, false then value
      end
    end
  end

  private

  # The invariant every report leans on. A `house_named` with no group is not a slightly worse row,
  # it is a row that corrupts every count keyed on a NULL group_id; and an anonymous event that
  # somehow acquired a house would put a visitor inside one. Neither is allowed to exist.
  def group_matches_name
    return if name.blank?

    if GROUP_NAMES.include?(name) && group_id.nil?
      errors.add(:group, "is required for #{name}")
    elsif ANONYMOUS_NAMES.include?(name) && group_id.present?
      errors.add(:group, "must be absent for #{name}")
    end
  end
end
