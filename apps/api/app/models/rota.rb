# A named job on a recurring schedule, worked through an ordered roster of members.
class Rota < ApplicationRecord
  INTERVAL_UNITS = %w[day week month].freeze

  belongs_to :group

  has_many :rota_positions, -> { order(:position) }, dependent: :destroy, inverse_of: :rota
  has_many :members, through: :rota_positions
  has_many :shifts, dependent: :destroy

  scope :active, -> { where(active: true) }

  before_save :normalise_reminder_offsets

  validates :name, presence: true
  validates :message_template, presence: true
  validates :starts_on, presence: true
  validates :interval_count, numericality: { only_integer: true, greater_than: 0 }
  validates :interval_unit, inclusion: { in: INTERVAL_UNITS }
  validates :send_hour, numericality: { only_integer: true, in: 0..23 }
  validate :reminder_offsets_must_be_whole_non_negative_days

  # A rota with no roster has nobody to assign, so generation is a no-op and the rota is in draft.
  # Derived from the roster, never stored: a flag and a roster can disagree, a derived method
  # cannot.
  def draft?
    rota_positions.empty?
  end

  private

  # Offsets mean the same thing in any order, so "0, 3" and "3, 0" are the same rota and neither
  # should be an error. Normalising on write — descending, so the furthest-out reminder reads
  # first — gives the column one canonical form without making the admin care about it.
  #
  # This runs on save rather than on validation so that the validation below still sees what was
  # actually typed. Rewriting the attribute first would destroy the evidence it depends on.
  def normalise_reminder_offsets
    self.reminder_offsets = (reminder_offsets || []).uniq.sort.reverse
  end

  # Read the raw assigned value, not the cast one. Postgres integer columns coerce rather than
  # complain: an admin who types "soon" into the offsets field gets `0` — a day-of reminder they
  # never asked for and cannot see they created. `_before_type_cast` is the only place the
  # difference between "soon" and 0 still exists.
  def reminder_offsets_must_be_whole_non_negative_days
    raw = reminder_offsets_before_type_cast
    return if raw.blank?

    unless raw.is_a?(Array) && raw.all? { |offset| whole_number?(offset) }
      errors.add(:reminder_offsets, "must all be a whole number of days")
      return
    end

    return if reminder_offsets.all? { |offset| offset >= 0 }

    errors.add(:reminder_offsets, "must all be zero or more days before the shift")
  end

  def whole_number?(value)
    case value
    when Integer then true
    when String then value.match?(/\A-?\d+\z/)
    else false
    end
  end
end
