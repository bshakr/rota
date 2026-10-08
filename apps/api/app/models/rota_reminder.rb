# One text a rota sends for each shift: when (days_before the shift's day; 0 is the day itself,
# negative is after it) and what it says.
class RotaReminder < ApplicationRecord
  DAYS_BEFORE_RANGE = -14..365

  # Twilio bills per 160-char segment and rejects a body over 1600 characters, so the template is
  # capped at save where the admin sees it. Sms::Renderer clamps the rendered body as the last guard.
  MESSAGE_TEMPLATE_MAX = 1000

  belongs_to :rota, inverse_of: :reminders
  has_many :sms_messages, dependent: :nullify

  # numericality reads the raw value, so "soon" is refused rather than cast to a day-of reminder.
  validates :days_before, numericality: { only_integer: true, in: DAYS_BEFORE_RANGE }
  validates :message_template, presence: true, length: { maximum: MESSAGE_TEMPLATE_MAX }
  validate :message_template_placeholders_must_be_known

  private

  # A typo caught at send time is a text somebody already received; caught here it costs nothing.
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
end
