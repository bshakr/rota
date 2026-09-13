# One occurrence of a calendar entry. A recurring event is many rows, one per expanded instance,
# keyed by `instance_key`. Dates are civil dates in the group's calendar so the member feed and the
# hand-off ranking compare them to `due_on` directly.
class CalendarEvent < ApplicationRecord
  KINDS = %w[event away].freeze

  belongs_to :calendar_connection
  has_many :calendar_event_members, dependent: :delete_all
  has_many :members, through: :calendar_event_members

  validates :uid, :instance_key, :summary, :starts_on, :ends_on, :fingerprint, :synced_at, presence: true
  validates :kind, inclusion: { in: KINDS }

  scope :overlapping, ->(from, to) { where("ends_on >= ? AND starts_on <= ?", from, to) }
  scope :away, -> { where(kind: "away") }
  # Pending means the model has not answered for this fingerprint yet: stored as a plain event with
  # nobody on it, and retried by the next sync.
  scope :pending, -> { where(classified_at: nil) }
  scope :classified, -> { where.not(classified_at: nil) }

  def away? = kind == "away"
end
