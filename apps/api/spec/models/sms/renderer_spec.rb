require "rails_helper"

RSpec.describe Sms::Renderer do
  include ActiveSupport::Testing::TimeHelpers

  let(:group) { create(:group, timezone: "Europe/London") }
  let(:member) { create(:member, group: group, name: "Alice") }
  let(:rota) { create(:rota, group: group, name: "Kitchen deep clean", message_template: template) }
  let(:template) { "Hi {{name}}! It's your turn for {{rota}} on {{date}} ({{days_until}}). Thanks" }

  def render(due_on: Date.new(2026, 7, 5))
    described_class.render(rota: rota, member: member, due_on: due_on)
  end

  describe "placeholders" do
    around { |example| travel_to(Time.utc(2026, 7, 2, 8, 0)) { example.run } }

    it "renders the whole message, placeholders substituted and link appended" do
      expect(render).to eq(<<~SMS.strip)
        Hi Alice! It's your turn for Kitchen deep clean on Sun 5 Jul (in 3 days). Thanks
        Manage: #{Rails.configuration.x.sms.app_url}/s/#{member.access_token}
      SMS
    end

    it "substitutes {{name}} with the member's name" do
      expect(render).to include("Hi Alice!")
    end

    it "substitutes {{rota}} with the rota's name" do
      expect(render).to include("for Kitchen deep clean")
    end

    it "substitutes {{date}} with the shift's date" do
      expect(render(due_on: Date.new(2026, 12, 1))).to include("on Tue 1 Dec")
    end

    it "tolerates whitespace inside the braces" do
      rota.update!(message_template: "Hi {{ name }}, {{  rota  }} is yours")

      expect(render).to start_with("Hi Alice, Kitchen deep clean is yours")
    end

    it "renders a template with no placeholders at all" do
      rota.update!(message_template: "Bins out please")

      expect(render).to start_with("Bins out please")
    end
  end

  describe "{{days_until}}" do
    # The countdown is the member's, not the server's: a shift is "today" when it is today *in the
    # group's time zone*, whatever the hour happens to be in UTC.
    around { |example| travel_to(Time.utc(2026, 7, 4, 23, 30)) { example.run } }

    let(:template) { "{{days_until}}" }
    let(:group) { create(:group, timezone: "Australia/Sydney") }

    it "counts from today in the group's time zone, not the server's" do
      # 23:30 UTC on the 4th is already 09:30 on the 5th in Sydney, so the 5th is today.
      expect(render(due_on: Date.new(2026, 7, 5))).to start_with("today")
    end

    it "says tomorrow" do
      expect(render(due_on: Date.new(2026, 7, 6))).to start_with("tomorrow")
    end

    it "counts the days out" do
      expect(render(due_on: Date.new(2026, 7, 8))).to start_with("in 3 days")
    end

    it "counts backwards for a shift already past" do
      expect(render(due_on: Date.new(2026, 7, 3))).to start_with("2 days ago")
    end
  end

  describe "the magic link" do
    it "is always appended, even when the template never mentions it" do
      rota.update!(message_template: "Bins out")

      expect(render).to eq("Bins out\nManage: #{Rails.configuration.x.sms.app_url}/s/#{member.access_token}")
    end

    it "is built from APP_URL config, never hardcoded" do
      original = Rails.configuration.x.sms.app_url
      Rails.configuration.x.sms.app_url = "https://rota.example.com"

      expect(render).to end_with("https://rota.example.com/s/#{member.access_token}")
    ensure
      Rails.configuration.x.sms.app_url = original
    end
  end

  describe "unknown placeholders" do
    it "refuses to render one rather than texting it out verbatim" do
      rota.update_column(:message_template, "Hi {{nmae}}")

      expect { render }.to raise_error(Sms::UnknownPlaceholder, /nmae/)
    end

    it "names every unknown placeholder in a template" do
      expect(described_class.unknown_placeholders("{{name}} {{nmae}} {{when}}")).to eq(%w[nmae when])
    end

    it "counts an empty placeholder as unknown" do
      expect(described_class.unknown_placeholders("Hi {{}}")).to eq([ "" ])
    end

    it "finds none in a template that only uses the vocabulary" do
      known = described_class::PLACEHOLDERS.map { |placeholder| "{{#{placeholder}}}" }.join(" ")

      expect(described_class.unknown_placeholders(known)).to eq([])
    end
  end

  describe ".for_shift" do
    let(:shift) { create(:shift, rota: rota, assigned_member: member, due_on: Date.new(2026, 7, 5)) }

    it "renders for whoever is responsible, so a handover needs no special reminder logic" do
      cover = create(:member, group: group, name: "Bob")
      shift.update!(covering_member: cover)

      expect(described_class.for_shift(shift)).to include("Hi Bob!", "/s/#{cover.access_token}")
    end

    it "renders for the assignee when nobody is covering" do
      expect(described_class.for_shift(shift)).to include("Hi Alice!")
    end

    it "renders for an explicitly named member, which is what a live preview wants" do
      other = create(:member, group: group, name: "Carol")

      expect(described_class.for_shift(shift, member: other)).to include("Hi Carol!")
    end
  end
end
