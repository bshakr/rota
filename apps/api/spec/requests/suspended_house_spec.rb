require "rails_helper"

# What suspending a house actually does, from the outside (BLO-1675).
#
# `groups.suspended_at` is one column, and it would be worth nothing if the app only knew about it in
# one place. The plan's "Suspension, precisely" lists five, each of them a different front door:
#
#   1. the house's admin API          — 403 `group_suspended`, with /api/me exempt   (here)
#   2. ReminderSweepJob               — the sweep skips the house   (spec/jobs/reminder_sweep_job_spec.rb)
#   3. TopUpShiftWindowsJob           — the top-up skips it         (spec/jobs/top_up_shift_windows_job_spec.rb)
#   4. the member magic-link path     — 200 `{ paused: true }`, covers refused 403   (here)
#   5. the public household entry     — 200 `{ paused: true }`, no text sent          (here)
#
# and one thing it deliberately does NOT do: Twilio's delivery receipts still land, because a receipt
# for a text that already went out is a fact about the past and dropping it would leave the house's
# log wrong forever.
#
# Nothing is deleted by any of it. The last section proves resume puts every one of them back.
RSpec.describe "A suspended house" do
  include ActiveJob::TestHelper

  let(:group) { create(:group, name: "Alma Road", workos_organization_id: "org_01FLAT") }
  let(:member) { create(:member, group: group, name: "Alice") }

  def admin_headers = workos_headers(sub: "user_01ALICE", org_id: group.workos_organization_id, role: "admin")

  def suspend! = group.update!(suspended_at: 1.hour.ago)

  # 1. The house's own admins.
  describe "the admin API" do
    it "is 403 group_suspended on every route but /api/me" do
      suspend!

      get "/api/group", headers: admin_headers

      expect(response).to have_http_status(:forbidden)
      expect(response.parsed_body).to eq("error" => "group_suspended")
    end

    # Every controller under Api::BaseController, not a hand-picked few: the refusal is in
    # Authenticatable, so a controller added tomorrow inherits it without anyone remembering to.
    it "refuses reads and writes alike" do
      suspend!
      rota = create(:rota, group: group)

      [
        -> { get "/api/rotas", headers: admin_headers },
        -> { get "/api/members", headers: admin_headers },
        -> { get "/api/sms_messages", headers: admin_headers },
        -> { patch "/api/group", params: { name: "Renamed" }, headers: admin_headers },
        -> { post "/api/members", params: { name: "New", phone: "+447400900001" }, headers: admin_headers },
        -> { patch "/api/rotas/#{rota.id}", params: { name: "Renamed" }, headers: admin_headers }
      ].each do |request|
        request.call

        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body).to eq("error" => "group_suspended")
      end

      expect(group.reload.name).to eq("Alma Road")
      expect(rota.reload.name).not_to eq("Renamed")
    end

    # The exemption the paused screen is built on: the web app has to be able to say WHICH house is
    # paused, and this is the only endpoint left that can tell it.
    it "still answers /api/me, so the paused screen can name the house" do
      suspend!

      get "/api/me", headers: admin_headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("group")).to include("name" => "Alma Road")
    end

    # The web never has to ask. The 403 on the route it actually wanted is what puts it on the
    # paused screen, and a second, weaker signal here would be one more thing that could disagree
    # with the enforcement.
    it "says nothing about suspension in the /api/me payload" do
      suspend!

      get "/api/me", headers: admin_headers

      expect(response.body).not_to include("suspended", "paused")
    end

    it "is 401, not 403, without a token: a paused house is not a way past authentication" do
      suspend!

      get "/api/group"

      expect(response).to have_http_status(:unauthorized)
    end

    # One house paused is one house paused.
    it "leaves every other house alone" do
      suspend!
      other = create(:group, workos_organization_id: "org_01OTHER")

      get "/api/group", headers: workos_headers(sub: "user_01BOB", org_id: other.workos_organization_id)

      expect(response).to have_http_status(:ok)
    end
  end

  # 4. The housemates. Their link goes on working — the link is not what was suspended — but there
  # is nothing behind it to show.
  describe "the member magic-link path" do
    it "answers 200 and a paused notice instead of the schedule" do
      suspend!

      get "/api/member/schedule", headers: member_headers(member)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("paused" => true, "house" => { "name" => "Alma Road" })
    end

    it "answers the same for the member's own shifts" do
      suspend!

      get "/api/member/shifts", headers: member_headers(member)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq("paused" => true, "house" => { "name" => "Alma Road" })
    end

    it "never mentions paused while the house is live" do
      get "/api/member/schedule", headers: member_headers(member)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).not_to have_key("paused")
    end

    it "is still 401 for a token that names nobody" do
      suspend!

      get "/api/member/schedule", headers: { "Authorization" => "Bearer nonsense" }

      expect(response).to have_http_status(:unauthorized)
    end

    # A cover is a WRITE, and a refused write has to be distinguishable from one that went through.
    describe "handing a shift over" do
      let(:bob) { create(:member, group: group, name: "Bob") }
      let(:rota) { create(:rota, group: group) }
      let(:shift) { create(:shift, rota: rota, assigned_member: member, due_on: 5.days.from_now.to_date) }

      it "is refused with 403 group_suspended, and changes nothing" do
        shift
        suspend!

        expect {
          post "/api/member/shifts/#{shift.id}/cover",
            params: { covering_member_id: bob.id }, headers: member_headers(member)
        }.not_to change { shift.reload.covering_member_id }

        expect(response).to have_http_status(:forbidden)
        expect(response.parsed_body).to include("error" => "group_suspended")
      end

      it "refuses taking a cover back the same way" do
        shift.update!(covering_member: bob)
        suspend!

        delete "/api/member/shifts/#{shift.id}/cover", headers: member_headers(member)

        expect(response).to have_http_status(:forbidden)
        expect(shift.reload.covering_member).to eq(bob)
      end

      it "texts nobody about a cover it refused" do
        shift
        suspend!

        expect {
          post "/api/member/shifts/#{shift.id}/cover",
            params: { covering_member_id: bob.id }, headers: member_headers(member)
        }.not_to change(SmsMessage, :count)
      end
    end
  end

  # 5. The public page a housemate lands on when they have lost their link.
  describe "the household entry page" do
    it "still names the house, and says it is paused" do
      suspend!

      get "/public/households/#{group.slug}"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).to eq(
        "household" => { "name" => "Alma Road", "slug" => group.slug }, "paused" => true
      )
    end

    it "says nothing about paused while the house is live" do
      get "/public/households/#{group.slug}"

      expect(response.parsed_body).not_to have_key("paused")
    end

    # The 202 has to go on saying nothing about the house or the number it was asked about, so a
    # paused house is answered exactly as an unknown one is — and no text is queued.
    it "accepts a link request without sending anything" do
      member
      suspend!

      expect {
        post "/public/households/#{group.slug}/request_link", params: { phone: member.phone_e164 }, as: :json
      }.not_to change(SmsMessage, :count)

      expect(response).to have_http_status(:accepted)
      expect(response.parsed_body).to eq("accepted" => true)
    end
  end

  # The one thing suspension deliberately does not touch. A receipt for a text that already went out
  # is a fact about the past; dropping it would leave the house's delivery log permanently wrong.
  describe "Twilio's delivery receipts" do
    it "still land, and still update the row" do
      suspend!
      rota = create(:rota, group: group)
      shift = create(:shift, rota: rota, assigned_member: member)
      message = create(:sms_message, shift: shift, member: member, status: "sent", twilio_sid: "SM#{SecureRandom.hex(16)}")

      params = { "MessageSid" => message.twilio_sid, "MessageStatus" => "delivered" }
      post twilio_status_webhook_path, params: params,
        headers: { "X-Twilio-Signature" => twilio_signature_for(params) }

      expect(response).to have_http_status(:no_content)
      expect(message.reload.status).to eq("delivered")
    end
  end

  # Nothing was deleted, so nothing has to be rebuilt: clearing one column puts every refusal back
  # the way it was. The reminder backlog that resuming does NOT fire is the last section of
  # spec/jobs/reminder_sweep_job_spec.rb.
  describe "resuming" do
    before do
      suspend!
      group.update!(suspended_at: nil)
    end

    it "gives the admins their API back" do
      get "/api/group", headers: admin_headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.fetch("group")).to include("name" => "Alma Road")
    end

    it "gives the housemates their schedule back" do
      get "/api/member/schedule", headers: member_headers(member)

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body).not_to have_key("paused")
      expect(response.parsed_body.fetch("member")).to include("name" => "Alice")
    end

    it "lets a shift be handed over again" do
      bob = create(:member, group: group, name: "Bob")
      rota = create(:rota, group: group)
      shift = create(:shift, rota: rota, assigned_member: member, due_on: 5.days.from_now.to_date)

      post "/api/member/shifts/#{shift.id}/cover",
        params: { covering_member_id: bob.id }, headers: member_headers(member)

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member).to eq(bob)
    end

    it "takes the paused notice off the household entry page, and sends links again" do
      get "/public/households/#{group.slug}"
      expect(response.parsed_body).not_to have_key("paused")

      expect {
        post "/public/households/#{group.slug}/request_link", params: { phone: member.phone_e164 }, as: :json
      }.to change(SmsMessage, :count).by(1)
    end
  end
end
