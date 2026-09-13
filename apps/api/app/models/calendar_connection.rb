# One house's link to its shared calendar, plus the bookkeeping the hourly sync needs. The link is a
# credential (anyone holding it can read the calendar) and is treated like a member's access token:
# stored as given, never serialised back out, masked for display, redacted from logs.
class CalendarConnection < ApplicationRecord
  FAILING_AFTER = 3
  # How much of the secret survives masking. Four characters are enough to tell two calendars
  # apart and far too few to guess the rest.
  SECRET_TAIL = 4
  # What a file name at the end of a feed path looks like. Deliberately narrow: a segment that does
  # not match is masked, so the cost of being wrong here is a duller display, never a leak.
  FILE_SEGMENT = /\.ics\z/i

  belongs_to :group
  has_many :calendar_events, dependent: :delete_all

  # Anchored at BOTH ends on purpose. `\A` alone accepts "https://ok.example\nanything-at-all",
  # because a Ruby regex without `\z` stops caring at the first newline — and this column is a
  # credential that is later handed to Net::HTTP, printed masked, and stored. `\S+` rather than `.+`
  # so the tail cannot be whitespace either. CalendarFetch re-checks the shape before it fetches;
  # this is the check that decides what may be written down.
  validates :ical_url, presence: true, format: { with: %r{\Ahttps://\S+\z}i, message: "must be an https link" }

  scope :enabled, -> { where(disabled_at: nil) }

  # Host plus the tail of the path: enough to recognise the link, not enough to use it. Providers
  # disagree about where the secret sits. Google and Outlook bury it in a folder above `basic.ics`,
  # while Apple, Nextcloud and Radicale end the path on the token itself, so there is no position
  # that is reliably safe to print. The rule is therefore the other way round: every segment is a
  # secret unless it is named like a file, and only the last four characters of a secret survive.
  def masked_url
    return "" if ical_url.blank?

    uri = URI.parse(ical_url)
    "#{uri.host}/…#{masked_path(uri.path)}"
  rescue URI::InvalidURIError
    "…#{ical_url.last(SECRET_TAIL)}"
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

  private

  # Renders at most four characters of the secret, plus a file name when the path ends in one. A
  # trailing slash is not a segment, so it cannot shift which segment is read as the secret, and the
  # query string never arrives here at all because the caller passes `uri.path`.
  def masked_path(path)
    segments = path.to_s.split("/").reject(&:empty?)
    file = segments.pop if segments.last&.match?(FILE_SEGMENT)
    [ segments.last&.last(SECRET_TAIL), file ].compact.join("/")
  end
end
