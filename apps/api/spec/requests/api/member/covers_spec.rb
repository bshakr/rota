require "rails_helper"

# POST/DELETE /api/member/shifts/:id/cover — the member path's one write, and the two cover rules it
# enforces: whoever is currently responsible may hand a shift on, and the original assignee may take
# it back. Every rejection the spec calls out is here, because a cover is agreed offline and the API
# is the only thing standing between "agreed" and "recorded".
RSpec.describe "Member cover assignment" do
  include ActiveJob::TestHelper

  let(:group) { create(:group) }
  let(:rota) { create(:rota, group: group, name: "Kitchen") }
  let(:alice) { create(:member, group: group, name: "Alice") }
  let(:bob) { create(:member, group: group, name: "Bob") }
  let(:cara) { create(:member, group: group, name: "Cara") }

  def future_shift(assigned: alice, covering: nil)
    create(:shift, rota: rota, assigned_member: assigned, covering_member: covering,
      due_on: 5.days.from_now.to_date)
  end

  def assign_cover(shift, member, covering_member_id:)
    post "/api/member/shifts/#{shift.id}/cover",
      params: { covering_member_id: covering_member_id }, headers: member_headers(member)
  end

  def cancel_cover(shift, member)
    delete "/api/member/shifts/#{shift.id}/cover", headers: member_headers(member)
  end

  describe "assigning a cover (rule 1: whoever is responsible can hand it on)" do
    it "lets the responsible member hand the shift to a contactable group member" do
      shift = future_shift(assigned: alice)

      assign_cover(shift, alice, covering_member_id: bob.id)

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member).to eq(bob)
      expect(response.parsed_body["shift"]).to include("id" => shift.id, "covered" => true)
      expect(response.parsed_body["shift"]["covering_member"]).to eq("id" => bob.id, "name" => "Bob")
    end

    it "enqueues a cover notice to the new cover, and to nobody else" do
      shift = future_shift(assigned: alice)

      expect { assign_cover(shift, alice, covering_member_id: bob.id) }
        .to have_enqueued_job(SendSmsJob).exactly(:once)

      notice = SmsMessage.cover_notice.find_by(shift: shift, member: bob)
      expect(notice).to be_present
      expect(notice.status).to eq("pending")
      expect(SmsMessage.cover_notice.where(shift: shift, member: alice)).to be_empty
    end

    it "hands the shift on twice: Alice -> Bob -> Cara" do
      shift = future_shift(assigned: alice)

      assign_cover(shift, alice, covering_member_id: bob.id)
      expect(shift.reload.responsible_member).to eq(bob)

      # Bob is now responsible, so Bob (not Alice) is the one who may hand it on again.
      assign_cover(shift, bob, covering_member_id: cara.id)

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member).to eq(cara)
      expect(shift.assigned_member).to eq(alice)
    end

    it "rejects covering a shift that is in the past" do
      shift = create(:shift, :past, rota: rota, assigned_member: alice)

      assign_cover(shift, alice, covering_member_id: bob.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("past_shift")
      expect(shift.reload.covering_member).to be_nil
    end

    it "rejects covering today's shift" do
      shift = create(:shift, rota: rota, assigned_member: alice, due_on: group.today)

      assign_cover(shift, alice, covering_member_id: bob.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("past_shift")
    end

    it "rejects handing a shift to yourself" do
      shift = future_shift(assigned: alice)

      assign_cover(shift, alice, covering_member_id: alice.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("self_cover")
    end

    it "rejects a covering member from another group as simply unavailable" do
      stranger = create(:member, group: create(:group))
      shift = future_shift(assigned: alice)

      assign_cover(shift, alice, covering_member_id: stranger.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("cover_unavailable")
      expect(shift.reload.covering_member).to be_nil
    end

    it "rejects an opted-out covering member" do
      quiet = create(:member, :opted_out, group: group)
      shift = future_shift(assigned: alice)

      assign_cover(shift, alice, covering_member_id: quiet.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("cover_unavailable")
    end

    it "rejects an inactive covering member" do
      idle = create(:member, :inactive, group: group)
      shift = future_shift(assigned: alice)

      assign_cover(shift, alice, covering_member_id: idle.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("cover_unavailable")
    end

    it "rejects a caller who is not the one currently responsible" do
      shift = future_shift(assigned: alice)

      # Bob is neither assigned nor covering, so he cannot hand Alice's shift to Cara.
      assign_cover(shift, bob, covering_member_id: cara.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("not_responsible")
      expect(shift.reload.covering_member).to be_nil
    end

    it "rejects handing the shift back to its original assignee as an assignment" do
      shift = future_shift(assigned: alice, covering: bob)

      # Bob is responsible; handing it to Alice is a take-back (a cancel), not an assignment.
      assign_cover(shift, bob, covering_member_id: alice.id)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("already_assignee")
    end

    it "404s when the shift belongs to another group, leaking nothing" do
      other_group = create(:group)
      other_shift = create(:shift, rota: create(:rota, group: other_group),
        assigned_member: create(:member, group: other_group), due_on: 5.days.from_now.to_date)

      assign_cover(other_shift, alice, covering_member_id: bob.id)

      expect(response).to have_http_status(:not_found)
    end

    it "refuses an unauthenticated request" do
      shift = future_shift(assigned: alice)

      post "/api/member/shifts/#{shift.id}/cover", params: { covering_member_id: bob.id }

      expect(response).to have_http_status(:unauthorized)
    end
  end

  describe "cancelling a cover (rule 2: the original assignee can take it back)" do
    it "lets the original assignee take the shift back" do
      shift = future_shift(assigned: alice, covering: bob)

      cancel_cover(shift, alice)

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member).to be_nil
      expect(shift.responsible_member).to eq(alice)
    end

    it "enqueues a cover notice to the member who was relieved" do
      shift = future_shift(assigned: alice, covering: bob)

      expect { cancel_cover(shift, alice) }.to have_enqueued_job(SendSmsJob).exactly(:once)

      expect(SmsMessage.cover_notice.find_by(shift: shift, member: bob)).to be_present
    end

    it "does not let an unrelated member cancel the cover" do
      shift = future_shift(assigned: alice, covering: bob)

      cancel_cover(shift, cara)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("not_original_assignee")
      expect(shift.reload.covering_member).to eq(bob)
    end

    it "does not let the current cover cancel their own cover — they hand it on instead" do
      shift = future_shift(assigned: alice, covering: bob)

      cancel_cover(shift, bob)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("not_original_assignee")
      expect(shift.reload.covering_member).to eq(bob)
    end

    it "rejects cancelling a shift that is not covered" do
      shift = future_shift(assigned: alice)

      cancel_cover(shift, alice)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("not_covered")
    end

    it "rejects cancelling a past shift" do
      shift = create(:shift, :past, rota: rota, assigned_member: alice, covering_member: bob)

      cancel_cover(shift, alice)

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["error"]).to eq("past_shift")
    end

    it "takes back a shift handed on twice, all the way to the original assignee" do
      shift = future_shift(assigned: alice, covering: bob)
      shift.update!(covering_member: cara) # Alice -> Bob -> Cara

      cancel_cover(shift, alice)

      expect(response).to have_http_status(:ok)
      expect(shift.reload.covering_member).to be_nil
      expect(shift.responsible_member).to eq(alice)
    end

    it "404s when the shift belongs to another group" do
      other_group = create(:group)
      other_shift = create(:shift, rota: create(:rota, group: other_group),
        assigned_member: create(:member, group: other_group),
        covering_member: create(:member, group: other_group), due_on: 5.days.from_now.to_date)

      cancel_cover(other_shift, alice)

      expect(response).to have_http_status(:not_found)
    end
  end

  # "The cover_notice SMS is enqueued to the right people" — proven all the way to the wire: the
  # enqueued job is run, and Twilio is asked to text exactly the affected party, at their number, with
  # their own magic link.
  describe "the cover notice reaches the right phone (WebMock)" do
    it "texts only the new cover, at their number, with their own link, on an assignment" do
      shift = future_shift(assigned: alice)
      send_request = stub_twilio_send

      perform_enqueued_jobs do
        assign_cover(shift, alice, covering_member_id: bob.id)
      end

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).with { |request|
        params = Rack::Utils.parse_nested_query(request.body)
        params["To"] == bob.phone_e164 && params["Body"].include?("/s/#{bob.access_token}")
      }).to have_been_made.once
      expect(send_request).to have_been_made.once # and to nobody else
    end

    it "texts the relieved member on a cancellation" do
      shift = future_shift(assigned: alice, covering: bob)
      stub_twilio_send

      perform_enqueued_jobs do
        cancel_cover(shift, alice)
      end

      expect(a_request(:post, TwilioStubs::MESSAGES_URL_PATTERN).with { |request|
        Rack::Utils.parse_nested_query(request.body)["To"] == bob.phone_e164
      }).to have_been_made.once
    end
  end
end
