require "rails_helper"

RSpec.describe "Api::SmsMessages" do
  let(:group) { create(:group, workos_organization_id: "org_01FLAT") }
  def headers = workos_headers(org_id: group.workos_organization_id)

  # A message on a real shift belonging to a rota in this group.
  def message_in_group(*traits, rota: nil, **attrs)
    rota ||= create(:rota, group: group)
    member = create(:member, group: group)
    shift = create(:shift, rota: rota, assigned_member: member)
    create(:sms_message, *traits, shift: shift, member: member, **attrs)
  end

  describe "GET /api/sms_messages" do
    it "returns the group's delivery log, newest first" do
      older = message_in_group
      older.update_columns(created_at: 2.days.ago)
      newer = message_in_group
      newer.update_columns(created_at: 1.hour.ago)

      get "/api/sms_messages", headers: headers

      expect(response).to have_http_status(:ok)
      ids = response.parsed_body["sms_messages"].map { |m| m["id"] }
      expect(ids).to eq([ newer.id, older.id ])
    end

    it "carries carrier status, the sent body, and enough of the shift to read the row" do
      sent = message_in_group(:sent)

      get "/api/sms_messages", headers: headers

      row = response.parsed_body["sms_messages"].first
      expect(row).to include("status" => "sent", "twilio_sid" => sent.twilio_sid, "body" => sent.body)
      expect(row["shift"]).to include("rota_name" => sent.shift.rota.name, "due_on" => sent.shift.due_on.to_s)
      expect(row["member"]).to include("name" => sent.member.name)
    end

    it "filters by status" do
      failed = message_in_group(:failed)
      message_in_group(:sent)

      get "/api/sms_messages", params: { status: "failed" }, headers: headers

      expect(response.parsed_body["sms_messages"].map { |m| m["id"] }).to eq([ failed.id ])
    end

    it "filters by rota" do
      mine = create(:rota, group: group, name: "Kitchen")
      wanted = message_in_group(rota: mine)
      message_in_group # a different rota

      get "/api/sms_messages", params: { rota_id: mine.id }, headers: headers

      expect(response.parsed_body["sms_messages"].map { |m| m["id"] }).to eq([ wanted.id ])
    end

    it "caps the page size" do
      3.times { message_in_group }

      get "/api/sms_messages", params: { limit: 2 }, headers: headers

      expect(response.parsed_body["sms_messages"].size).to eq(2)
    end

    it "shows only this group's messages" do
      mine = message_in_group
      other_group = create(:group)
      other_member = create(:member, group: other_group)
      other_shift = create(:shift, rota: create(:rota, group: other_group), assigned_member: other_member)
      create(:sms_message, shift: other_shift, member: other_member)

      get "/api/sms_messages", headers: headers

      expect(response.parsed_body["sms_messages"].map { |m| m["id"] }).to eq([ mine.id ])
    end
  end
end
