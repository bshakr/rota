require "rails_helper"

RSpec.describe "Personal-link SMS delivery" do
  let(:member) { create(:member) }
  let(:message) { SmsMessage.create!(member: member, kind: :member_login) }

  it "uses the existing sender and records a shift-free delivery receipt" do
    request = stub_twilio_send
    SendSmsJob.perform_now(message.id)
    expect(request).to have_been_requested.once
    expect(message.reload).to be_sent
    expect(message.body).to include("/s/#{member.access_token}", "Keep this link private")
    expect(SmsMessageSerializer.new(message).as_json[:shift]).to be_nil
    SendSmsJob.perform_now(message.id)
    expect(request).to have_been_requested.once
  end

  it "rechecks contactability when sending, not only when requesting" do
    message
    member.update!(active: false)
    SendSmsJob.perform_now(message.id)
    expect(message.reload).to have_attributes(status: "failed", error_code: "not_contactable")
  end

  it "still requires shifts on reminder and cover messages" do
    expect(build(:sms_message, member: member, shift: nil)).not_to be_valid
    expect(build(:sms_message, member: member, kind: :cover_notice, shift: nil, days_before: nil)).not_to be_valid
    expect(build(:sms_message, kind: :member_login)).not_to be_valid
  end

  it "honors SMS opt-out after a personal link was queued" do
    message
    member.update!(sms_opted_out_at: Time.current)
    expect(Sms).not_to receive(:deliver)
    SendSmsJob.perform_now(message.id)
    expect(message.reload).to have_attributes(status: "failed", error_code: "not_contactable")
  end
end
