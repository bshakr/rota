# A named job on a recurring schedule, worked through an ordered roster of members.
class Rota < ApplicationRecord
  INTERVAL_UNITS = %w[day week month].freeze

  # A reminder is a short text. Twilio bills per 160-char (GSM-7) segment and rejects a body over
  # 1600 characters outright, so an unbounded template is a way to bill for thirty segments a
  # reminder or fail every send. Capped here, at save, so the admin sees the limit rather than
  # discovering silent truncation in a delivered text. Comfortably several segments — generous for
  # a reminder, bounded against abuse. Sms::Renderer clamps the rendered body as the final guard.
  MESSAGE_TEMPLATE_MAX = 1000

  belongs_to :group

  has_many :rota_positions, -> { order(:position) }, dependent: :destroy, inverse_of: :rota
  has_many :members, through: :rota_positions
  has_many :shifts, dependent: :destroy

  scope :active, -> { where(active: true) }

  before_save :normalise_reminder_offsets

  validates :name, presence: true
  validates :message_template, presence: true, length: { maximum: MESSAGE_TEMPLATE_MAX }
  validates :starts_on, presence: true
  validates :interval_count, numericality: { only_integer: true, greater_than: 0 }
  validates :interval_unit, inclusion: { in: INTERVAL_UNITS }
  validates :send_hour, numericality: { only_integer: true, in: 0..23 }
  validate :reminder_offsets_must_be_whole_non_negative_days
  validate :message_template_placeholders_must_be_known

  # A rota with no roster has nobody to assign, so generation is a no-op and the rota is in draft.
  # Derived from the roster, never stored: a flag and a roster can disagree, a derived method
  # cannot.
  def draft?
    rota_positions.empty?
  end

  private

  # A typo in a template — {{nmae}}, or an unbalanced brace like `{{name}` — has exactly one moment
  # where it can be caught for free: the moment the admin types it. Caught at send time instead, it
  # is already a text that somebody received with the mistake in it, and a text cannot be recalled.
  # So the vocabulary and the braces are enforced here, loudly, at save. Sms::Renderer owns both
  # checks; this only asks it.
  def message_template_placeholders_must_be_known
    known = Sms::Renderer::PLACEHOLDERS.map { |placeholder| "{{#{placeholder}}}" }.join(", ")

    if Sms::Renderer.stray_braces?(message_template)
      errors.add(:message_template, "has an unbalanced or stray brace. Placeholders look like: #{known}")
      return
    end

    unknown = Sms::Renderer.unknown_placeholders(message_template)
    return if unknown.empty?

    errors.add(
      :message_template,
      "has unknown placeholders: #{unknown.map { |name| "{{#{name}}}" }.join(', ')}. Known: #{known}"
    )
  end

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
    raw = raw_reminder_offsets
    return if raw.blank?

    unless raw.all? { |offset| whole_number?(offset) }
      errors.add(:reminder_offsets, "must all be a whole number of days")
      return
    end

    return if reminder_offsets.all? { |offset| offset >= 0 }

    errors.add(:reminder_offsets, "must all be zero or more days before the shift")
  end

  # `_before_type_cast` hands back what was assigned only when a user assigned it. For a row read
  # back from Postgres it hands back the raw array literal — the String "{3,0}" — so treating it
  # as the assigned value would fail every rota ever loaded, and no saved rota could be edited
  # again. A stored value was already checked on the way in; only a user-assigned one can still
  # be hiding the word "soon".
  def raw_reminder_offsets
    raw = reminder_offsets_before_type_cast
    raw.is_a?(Array) ? raw : reminder_offsets
  end

  def whole_number?(value)
    case value
    when Integer then true
    when String then value.match?(/\A-?\d+\z/)
    else false
    end
  end
end
