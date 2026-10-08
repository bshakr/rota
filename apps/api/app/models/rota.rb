# A named job on a recurring schedule, worked through an ordered roster of members.
class Rota < ApplicationRecord
  INTERVAL_UNITS = %w[day week month].freeze

  MAX_REMINDERS = 10
  COVER_NOTICE_FALLBACK = "Hi {{name}}, you're now down for {{rota}} on {{date}} ({{days_until}}).".freeze

  belongs_to :group

  has_many :rota_positions, -> { order(:position) }, dependent: :destroy, inverse_of: :rota
  has_many :members, through: :rota_positions
  has_many :shifts, dependent: :destroy
  # Validated by #reminders_must_be_valid instead, so errors carry the submitted index.
  has_many :reminders, -> { order(days_before: :desc, id: :asc) },
    class_name: "RotaReminder", inverse_of: :rota, autosave: true, validate: false

  scope :active, -> { where(active: true) }

  before_save :mirror_legacy_reminder_columns, if: :reminders_changed?
  after_save -> { @submitted_reminders = nil }

  validates :name, presence: true
  validates :starts_on, presence: true
  validates :interval_count, numericality: { only_integer: true, greater_than: 0 }
  validates :interval_unit, inclusion: { in: INTERVAL_UNITS }
  validates :send_hour, numericality: { only_integer: true, in: 0..23 }
  validate :reminders_must_be_valid

  # A rota with no roster has nobody to assign, so generation is a no-op and the rota is in draft.
  # Derived from the roster, never stored: a flag and a roster can disagree, a derived method
  # cannot.
  def draft?
    rota_positions.empty?
  end

  # A cover notice reuses the text of the furthest-out reminder before the shift: it says whose turn
  # it is and when, which is what a cover needs to hear. After-shift texts ("thanks!") would not, so
  # a rota with none before the shift uses the fixed text.
  def cover_notice_template
    reminders.find { |reminder| reminder.days_before >= 0 }&.message_template || COVER_NOTICE_FALLBACK
  end

  # Replaces the whole list. An item with an id updates that reminder, one without is created, and
  # any reminder left out is destroyed on save. An id that is not this rota's is a validation error.
  def replace_reminders(items)
    existing = reminders.index_by(&:id)
    @submitted_reminders = items.map do |item|
      item = item.to_h.symbolize_keys
      attributes = item.slice(:days_before, :message_template)
      if item[:id].present?
        existing.delete(item[:id].to_s.to_i)&.tap { |reminder| reminder.assign_attributes(attributes) }
      else
        reminders.build(attributes)
      end
    end
    existing.each_value(&:mark_for_destruction)
  end

  private

  def reminders_changed?
    reminders.loaded? && reminders.any?(&:changed_for_autosave?)
  end

  def live_reminders
    reminders.reject(&:marked_for_destruction?)
  end

  def reminders_must_be_valid
    errors.add(:reminders, "can be at most #{MAX_REMINDERS}") if live_reminders.size > MAX_REMINDERS

    (@submitted_reminders || live_reminders).each_with_index do |reminder, index|
      if reminder.nil?
        errors.add(:"reminders[#{index}].id", "is not a reminder of this rota")
        next
      end
      next if reminder.valid?

      reminder.errors.each { |error| errors.add(:"reminders[#{index}].#{error.attribute}", error.message) }
    end
  end

  # Kept in step so a rollback to the previous release, which still reads these, sends what it can:
  # it only knows non-negative timings and one template.
  def mirror_legacy_reminder_columns
    live = live_reminders.sort_by { |reminder| [ -reminder.days_before.to_i, reminder.id || Float::INFINITY ] }
    self.reminder_offsets = live.map(&:days_before).select { |days| days.to_i >= 0 }.uniq
    self.message_template = live.first.message_template if live.any?
  end
end
