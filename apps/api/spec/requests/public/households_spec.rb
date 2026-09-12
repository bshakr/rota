require "rails_helper"

RSpec.describe "Public household entry" do
  include ActiveJob::TestHelper

  let(:group) { create(:group, name: "Park Vista") }
  let!(:member) { create(:member, group: group) }

  def request_link(phone = member.phone_e164, slug: group.slug)
    post "/public/households/#{slug}/request_link", params: { phone: phone }, as: :json
  end

  it "exposes only the name and slug without WorkOS login" do
    get "/public/households/#{group.slug}"
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body).to eq("household" => { "name" => "Park Vista", "slug" => group.slug })
    expect(response.headers["Cache-Control"]).to eq("no-store")
  end

  it "returns 404 for a missing household" do
    get "/public/households/missing"
    expect(response).to have_http_status(:not_found)
  end

  it "queues one personal link, never returns a token, and needs no shift" do
    expect { request_link }.to have_enqueued_job(SendSmsJob)
    expect(response).to have_http_status(:accepted)
    expect(response.parsed_body).to eq("accepted" => true)
    expect(SmsMessage.last).to have_attributes(member_id: member.id, kind: "member_login", shift_id: nil)
  end

  it "normalizes formatted numbers" do
    request_link("#{member.phone_e164.first(3)} #{member.phone_e164[3..]}")
    expect(SmsMessage.last.member_id).to eq(member.id)
  end

  it "returns identical acceptance for unknown, malformed, opted-out and inactive numbers" do
    request_link
    expected = response.body
    SmsMessage.delete_all
    [ "+447400999999", "invalid", nil, { value: member.phone_e164 }, "x" * 41 ].each do |phone|
      expect { request_link(phone) }.not_to change(SmsMessage, :count)
      expect(response).to have_http_status(:accepted)
      expect(response.body).to eq(expected)
    end
    member.update!(sms_opted_out_at: Time.current)
    expect { request_link }.not_to change(SmsMessage, :count)
    expect(response.body).to eq(expected)
    member.update!(sms_opted_out_at: nil, active: false)
    expect { request_link }.not_to change(SmsMessage, :count)
    expect(response.body).to eq(expected)
  end

  it "cannot request a member's link through another household" do
    other = create(:group)
    expect { request_link(slug: other.slug) }.not_to change(SmsMessage, :count)
    expect(response.parsed_body).to eq("accepted" => true)
  end

  it "does not select an arbitrary identity when active members share a number" do
    create(:member, group: group, phone_e164: member.phone_e164)
    expect { request_link }.not_to change(SmsMessage, :count)
  end

  it "does not send twice inside a minute, including different number formatting" do
    request_link
    expect { request_link(" #{member.phone_e164} ") }.not_to change(SmsMessage, :count)
    expect(response).to have_http_status(:accepted)
  end

  it "allows at most three attempts per phone per rolling hour, even across households" do
    3.times { SmsMessage.create!(member: member, kind: :member_login, status: :failed, created_at: 5.minutes.ago) }
    other = create(:group)
    create(:member, group: other, phone_e164: member.phone_e164)
    expect { request_link(slug: other.slug) }.not_to change(SmsMessage, :count)
    travel 61.minutes
    expect { request_link(slug: other.slug) }.to change(SmsMessage, :count).by(1)
  end

  it "caps a household at sixty attempts per hour" do
    other = create(:member, group: group)
    60.times { SmsMessage.create!(member: other, kind: :member_login) }
    expect { request_link }.not_to change(SmsMessage, :count)
  end

  it "caps the whole service at one hundred attempts per hour" do
    other = create(:member)
    100.times { SmsMessage.create!(member: other, kind: :member_login) }
    expect { request_link }.not_to change(SmsMessage, :count)
  end

  it "does not create members or households during either a matched or unknown login" do
    expect { request_link }.not_to change(Member, :count)
    expect { request_link("+447700900123", slug: "missing") }.not_to change(Group, :count)
    expect { request_link("+447700900123") }.not_to change(Member, :count)
  end

  it "caps each phone at five attempts per rolling day" do
    5.times { SmsMessage.create!(member: member, kind: :member_login, created_at: 2.hours.ago) }
    expect { request_link }.not_to change(SmsMessage, :count)
  end

  it "caps the whole service at two hundred attempts per rolling day" do
    other = create(:member)
    200.times { SmsMessage.create!(member: other, kind: :member_login, created_at: 2.hours.ago) }
    expect { request_link }.not_to change(SmsMessage, :count)
    expect(response).to have_http_status(:accepted)
    travel 25.hours
    expect { request_link }.to change(SmsMessage, :count).by(1)
  end
end
