require "rails_helper"

RSpec.describe "POST /webhooks/twilio/status" do
  let(:sms_message) { create(:sms_message, :sent, twilio_sid: "SM00000000000000000000000000000001") }

  def post_callback(params, signature: nil)
    post twilio_status_webhook_path,
      params: params,
      headers: { "X-Twilio-Signature" => signature || twilio_signature_for(params) }
  end

  describe "a properly signed callback" do
    it "marks a delivered message delivered" do
      post_callback({ "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "delivered" })

      expect(response).to have_http_status(:no_content)
      expect(sms_message.reload.status).to eq("delivered")
    end

    it "marks an undelivered message failed and records the carrier's error code" do
      post_callback({
        "MessageSid" => sms_message.twilio_sid,
        "MessageStatus" => "undelivered",
        "ErrorCode" => "30006"
      })

      expect(sms_message.reload).to have_attributes(status: "failed", error_code: "30006")
    end

    it "marks a failed message failed" do
      post_callback({
        "MessageSid" => sms_message.twilio_sid,
        "MessageStatus" => "failed",
        "ErrorCode" => "30003"
      })

      expect(sms_message.reload).to have_attributes(status: "failed", error_code: "30003")
    end

    it "ignores an intermediate status rather than walking a delivered row backwards" do
      sms_message.update!(status: :delivered)

      post_callback({ "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "sent" })

      expect(response).to have_http_status(:no_content)
      expect(sms_message.reload.status).to eq("delivered")
    end

    it "accepts a SID it has never heard of without complaining, so Twilio stops retrying" do
      post_callback({ "MessageSid" => "SM99999999999999999999999999999999", "MessageStatus" => "delivered" })

      expect(response).to have_http_status(:no_content)
      expect(sms_message.reload.status).to eq("sent")
    end
  end

  describe "a callback we cannot trust" do
    it "refuses an invalid signature and changes nothing" do
      post_callback(
        { "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "delivered" },
        signature: "not-the-signature"
      )

      expect(response).to have_http_status(:forbidden)
      expect(sms_message.reload.status).to eq("sent")
    end

    it "refuses a request with no signature at all" do
      post twilio_status_webhook_path,
        params: { "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "delivered" }

      expect(response).to have_http_status(:forbidden)
      expect(sms_message.reload.status).to eq("sent")
    end

    it "refuses a signature that was valid for different parameters" do
      # The signature covers every parameter, so swapping the status after signing must not verify.
      # Otherwise anyone who ever saw one valid callback could mark any message delivered.
      signature = twilio_signature_for(
        { "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "failed" }
      )

      post_callback(
        { "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "delivered" },
        signature: signature
      )

      expect(response).to have_http_status(:forbidden)
      expect(sms_message.reload.status).to eq("sent")
    end

    it "refuses a signature computed for a different URL" do
      params = { "MessageSid" => sms_message.twilio_sid, "MessageStatus" => "delivered" }

      post_callback(params, signature: twilio_signature_for(params, url: "https://evil.example/status"))

      expect(response).to have_http_status(:forbidden)
      expect(sms_message.reload.status).to eq("sent")
    end
  end
end
