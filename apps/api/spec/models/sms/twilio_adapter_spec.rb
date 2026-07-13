require "rails_helper"

RSpec.describe Sms::TwilioAdapter do
  subject(:adapter) { described_class.new }

  def deliver
    adapter.deliver(to: "+15005550006", body: "Bins tomorrow", status_callback: Sms.status_callback_url)
  end

  it "returns the SID and status Twilio gave it" do
    stub_twilio_send(sid: "SM00000000000000000000000000000001", status: "queued")

    expect(deliver).to have_attributes(sid: "SM00000000000000000000000000000001", status: "queued")
  end

  # The classification is the whole job of this class: everything downstream — retry or fail, once
  # or five times — follows from which of these two it raises.
  describe "what it makes of a refusal" do
    it "treats a 4xx as permanent, because Twilio will say the same thing next time" do
      stub_twilio_error(status: 400, code: 21_211, message: "Invalid 'To' Phone Number")

      expect { deliver }.to raise_error(Sms::PermanentFailure) { |error|
        expect(error.error_code).to eq("21211")
      }
    end

    it "treats a 429 as transient, because it means slow down rather than no" do
      stub_twilio_error(status: 429, code: 20_429, message: "Too Many Requests")

      expect { deliver }.to raise_error(Sms::TransientFailure)
    end

    it "treats a 5xx as transient" do
      stub_twilio_server_error

      expect { deliver }.to raise_error(Sms::TransientFailure)
    end

    it "treats a dropped connection as transient" do
      stub_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).to_timeout

      expect { deliver }.to raise_error(Sms::TransientFailure)
    end
  end
end
