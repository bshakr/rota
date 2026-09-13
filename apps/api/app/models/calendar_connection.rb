# One house's link to its shared calendar, plus the bookkeeping the hourly sync needs. The link is a
# credential (anyone holding it can read the calendar) and is treated like a member's access token:
# stored as given, never serialised back out, masked for display, redacted from logs.
class CalendarConnection < ApplicationRecord
  FAILING_AFTER = 3
  # How much of the path survives masking. Long enough to tell two calendars apart, short enough
  # that the secret segment of a Google private address never appears.
  MASK_TAIL = 15

  belongs_to :group
  has_many :calendar_events, dependent: :delete_all

  validates :ical_url, presence: true, format: { with: %r{\Ahttps://}i, message: "must be an https link" }

  scope :enabled, -> { where(disabled_at: nil) }

  # Host plus the last few characters of the path: enough to recognise the link, not enough to use it.
  def masked_url
    uri = URI.parse(ical_url)
    "#{uri.host}/…#{uri.path.last(MASK_TAIL)}"
  rescue URI::InvalidURIError
    "…#{ical_url.last(MASK_TAIL)}"
  end

  def failing?
    disabled_at.present? || consecutive_failures >= FAILING_AFTER
  end

  # How many occurrences are still waiting on a verdict (spec 7.4). Counted rather than stored: it
  # only changes when a sync runs, and only the settings card ever asks.
  def unclassified_count = calendar_events.pending.count

  def record_failure!(message, disable: false)
    update!(consecutive_failures: consecutive_failures + 1, last_error: message,
            last_fetched_at: Time.current, disabled_at: disable ? Time.current : disabled_at)
  end

  def record_success!(**attrs)
    update!(attrs.merge(consecutive_failures: 0, last_error: nil, disabled_at: nil,
                        last_fetched_at: Time.current, last_synced_at: Time.current))
  end
end
