require "rails_helper"

# CoverNotice is the seam between the cover flow and the SMS engine. It never calls Twilio: `record`
# lays down a pending cover_notice row and returns its id; `enqueue` hands that id to SendSmsJob,
# which renders the rota's template for that member (appending their own magic link) and records the
# result — the same path every other text takes. The two are split so ShiftCover can record inside the
# locked transaction and the caller enqueues only after it commits.
RSpec.describe CoverNotice do
  include ActiveJob::TestHelper

  let(:group) { create(:group) }
  let(:rota) { create(:rota, group: group) }
  let(:alice) { create(:member, group: group, name: "Alice") }
  let(:bob) { create(:member, group: group, name: "Bob") }
  let(:shift) { create(:shift, rota: rota, assigned_member: alice, due_on: 5.days.from_now.to_date) }

  describe ".record" do
    it "creates a pending cover_notice row per recipient and returns their ids" do
      ids = described_class.record(shift: shift, to: [ alice, bob ])

      notices = SmsMessage.cover_notice.where(shift: shift)
      expect(notices.map(&:member)).to contain_exactly(alice, bob)
      expect(notices.map(&:id)).to match_array(ids)
      expect(notices.map(&:status).uniq).to eq([ "pending" ])
      # A cover notice is not one of the shift's scheduled reminders, so it carries no offset.
      expect(notices.map(&:days_before).uniq).to eq([ nil ])
    end

    it "skips a member it is not allowed to text rather than creating a doomed row" do
      opted_out = create(:member, :opted_out, group: group)

      ids = described_class.record(shift: shift, to: [ opted_out ])

      expect(ids).to be_empty
      expect(SmsMessage.cover_notice.where(shift: shift)).to be_empty
    end

    it "accepts a single member as well as a list" do
      expect(described_class.record(shift: shift, to: bob).size).to eq(1)
    end
  end

  describe ".enqueue" do
    it "enqueues a send for each id" do
      ids = described_class.record(shift: shift, to: [ alice, bob ])

      expect { described_class.enqueue(ids) }.to have_enqueued_job(SendSmsJob).exactly(:twice)
    end

    it "enqueues each message's own id, so the job sends the right text" do
      id = described_class.record(shift: shift, to: bob).first

      expect { described_class.enqueue([ id ]) }.to have_enqueued_job(SendSmsJob).with(id)
    end

    it "does nothing for an empty list" do
      expect { described_class.enqueue([]) }.not_to have_enqueued_job(SendSmsJob)
    end
  end
end
