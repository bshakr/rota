require "rails_helper"

RSpec.describe RotaReminder do
  it "is valid with the factory" do
    expect(build(:rota_reminder)).to be_valid
  end

  it "requires a message template" do
    reminder = build(:rota_reminder, message_template: "")

    expect(reminder).not_to be_valid
    expect(reminder.errors[:message_template]).to be_present
  end

  it "is refused by the database outside two weeks after to a year before" do
    reminder = create(:rota_reminder)

    expect { reminder.update_column(:days_before, -15) }.to raise_error(ActiveRecord::StatementInvalid, /days_before_in_range/)
  end

  it "leaves the texts it sent in the log when deleted" do
    message = create(:sms_message, days_before: 3)

    message.rota_reminder.destroy!

    expect(message.reload).to have_attributes(rota_reminder_id: nil, days_before: 3)
  end

  it "goes with its rota" do
    rota = create(:rota)

    expect { rota.destroy! }.to change(described_class, :count).by(-2)
  end

  # A template is only ever wrong at one moment that costs nothing to fix: the moment it is typed.
  # A text cannot be recalled, so an unknown placeholder is rejected at save, never discovered at
  # send. Sms::Renderer owns the vocabulary.
  describe "the message template's placeholders" do
    it "accepts every placeholder the renderer knows" do
      known = Sms::Renderer::PLACEHOLDERS.map { |placeholder| "{{#{placeholder}}}" }.join(" ")

      expect(build(:rota_reminder, message_template: known)).to be_valid
    end

    it "accepts a template with no placeholders at all" do
      expect(build(:rota_reminder, message_template: "Bins out please")).to be_valid
    end

    it "rejects a typo rather than texting it out verbatim" do
      reminder = build(:rota_reminder, message_template: "Hi {{nmae}}!")

      expect(reminder).not_to be_valid
      expect(reminder.errors[:message_template].first).to include("{{nmae}}")
    end

    it "names every unknown placeholder, so the admin fixes them in one pass" do
      reminder = build(:rota_reminder, message_template: "{{name}} {{nmae}} {{when}}")

      expect(reminder).not_to be_valid
      expect(reminder.errors[:message_template].first).to include("{{nmae}}", "{{when}}")
    end

    it "lists the known placeholders in the error, so the admin does not have to guess" do
      reminder = build(:rota_reminder, message_template: "{{nmae}}")

      expect(reminder).not_to be_valid
      expect(reminder.errors[:message_template].first).to include("{{name}}", "{{days_until}}")
    end

    it "rejects an unbalanced brace rather than letting it reach a text" do
      reminder = build(:rota_reminder, message_template: "Hi {{name}")

      expect(reminder).not_to be_valid
      expect(reminder.errors[:message_template].first).to include("unbalanced or stray brace")
    end

    it "rejects a template longer than the segment budget" do
      reminder = build(:rota_reminder, message_template: "x" * (RotaReminder::MESSAGE_TEMPLATE_MAX + 1))

      expect(reminder).not_to be_valid
      expect(reminder.errors[:message_template]).to be_present
    end

    it "accepts a template at the maximum length" do
      expect(build(:rota_reminder, message_template: "x" * RotaReminder::MESSAGE_TEMPLATE_MAX)).to be_valid
    end
  end
end
