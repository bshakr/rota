require "rails_helper"

RSpec.describe SendSmsJob do
  include ActiveJob::TestHelper

  let(:group) { create(:group, timezone: "Europe/London") }
  let(:member) { create(:member, group: group, name: "Alice") }
  let(:rota) { create(:rota, group: group, name: "Bins") }
  let(:shift) { create(:shift, rota: rota, assigned_member: member, due_on: 3.days.from_now.to_date) }
  let(:sms_message) { create(:sms_message, shift: shift, member: member, days_before: 3) }

  describe "a successful send" do
    it "renders the template, sends it, and records the SID" do
      request = stub_twilio_send(sid: "SM00000000000000000000000000000001")

      described_class.perform_now(sms_message.id)

      expect(request).to have_been_requested
      expect(sms_message.reload).to have_attributes(
        status: "sent",
        twilio_sid: "SM00000000000000000000000000000001",
        error_code: nil
      )
      expect(sms_message.sent_at).to be_present
    end

    it "persists the body it actually sent, so the SMS log shows the text the member got" do
      stub_twilio_send

      described_class.perform_now(sms_message.id)

      expect(sms_message.reload.body).to eq(Sms::Renderer.for_shift(shift))
      expect(sms_message.body).to include("Hi Alice!", "/s/#{member.access_token}")
    end

    it "asks Twilio to post its delivery receipts back to the status webhook" do
      stub_twilio_send

      described_class.perform_now(sms_message.id)

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).with { |request|
        params = Rack::Utils.parse_nested_query(request.body)

        params["To"] == member.phone_e164 &&
          params["From"] == Rails.configuration.x.twilio.from_number &&
          params["StatusCallback"] == Sms.status_callback_url &&
          params["Body"].include?("Hi Alice!")
      }).to have_been_made
    end

    it "texts the cover rather than the assignee after a handover" do
      stub_twilio_send
      cover = create(:member, group: group, name: "Bob")
      shift.update!(covering_member: cover)
      sms_message.update!(member: cover)

      described_class.perform_now(sms_message.id)

      expect(sms_message.reload.body).to include("Hi Bob!", "/s/#{cover.access_token}")
    end
  end

  describe "a member we are not allowed to text" do
    it "skips an opted-out member and records why" do
      member.update!(sms_opted_out_at: 1.day.ago)

      described_class.perform_now(sms_message.id)

      expect(sms_message.reload).to have_attributes(
        status: "failed",
        error_code: SmsMessage::NOT_CONTACTABLE,
        twilio_sid: nil
      )
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end

    it "skips an inactive member and records why" do
      member.update!(active: false)

      described_class.perform_now(sms_message.id)

      expect(sms_message.reload.error_code).to eq(SmsMessage::NOT_CONTACTABLE)
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end
  end

  describe "a Twilio failure that will not fix itself" do
    it "records the carrier error code and does not retry" do
      stub_twilio_error(status: 400, code: 21_610, message: "Attempt to send to unsubscribed recipient")

      expect { described_class.perform_now(sms_message.id) }
        .not_to have_enqueued_job(described_class)

      expect(sms_message.reload).to have_attributes(status: "failed", error_code: "21610", twilio_sid: nil)
    end
  end

  describe "a Twilio failure that might" do
    it "retries rather than failing the row" do
      stub_twilio_server_error

      expect { described_class.perform_now(sms_message.id) }
        .to have_enqueued_job(described_class).with(sms_message.id)

      expect(sms_message.reload.status).to eq("pending")
    end

    it "records the failure once the retries run out" do
      stub_twilio_server_error

      perform_enqueued_jobs { described_class.perform_later(sms_message.id) }

      # twilio-ruby discards a 5xx body and substitutes its own `{ code: <http status> }`, so the
      # only carrier code there is to record for a server error is the status itself.
      expect(sms_message.reload).to have_attributes(status: "failed", error_code: "500")
      # Five attempts, per retry_on. Any more is money and rate limit spent on a message Twilio has
      # already refused five times.
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).to have_been_made.times(5)
    end

    it "treats a dropped connection as retryable" do
      stub_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).to_timeout

      expect { described_class.perform_now(sms_message.id) }.to have_enqueued_job(described_class)
      expect(sms_message.reload.status).to eq("pending")
    end
  end

  describe "a row that must not be sent twice" do
    it "does nothing for a row that has already been sent" do
      sms_message.update!(status: :sent, twilio_sid: "SM00000000000000000000000000000009")

      described_class.perform_now(sms_message.id)

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
      expect(sms_message.reload.twilio_sid).to eq("SM00000000000000000000000000000009")
    end

    it "does nothing for a row that has already been delivered" do
      sms_message.update!(status: :delivered)

      described_class.perform_now(sms_message.id)

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
      expect(sms_message.reload.status).to eq("delivered")
    end

    it "does nothing for a row that has since been deleted" do
      id = sms_message.id
      sms_message.destroy!

      expect { described_class.perform_now(id) }.not_to raise_error
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end
  end

  describe "a template that should never have been saved" do
    it "fails the row rather than texting a literal placeholder" do
      rota.update_column(:message_template, "Hi {{nmae}}")

      described_class.perform_now(sms_message.id)

      expect(sms_message.reload).to have_attributes(
        status: "failed",
        error_code: SmsMessage::INVALID_TEMPLATE
      )
      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN)).not_to have_been_made
    end
  end
end
