require "rails_helper"

# CoverNotice is the seam between the cover flow and the SMS engine. It never calls Twilio: it lays
# down a pending cover_notice row and enqueues SendSmsJob, exactly as the reminder sweep does, so a
# cover notice inherits the same retries, idempotent claim and SMS-log entry as every other text.
RSpec.describe CoverNotice do
  include ActiveJob::TestHelper

  let(:group) { create(:group) }
  let(:rota) { create(:rota, group: group) }
  let(:alice) { create(:member, group: group, name: "Alice") }
  let(:bob) { create(:member, group: group, name: "Bob") }
  let(:shift) { create(:shift, rota: rota, assigned_member: alice, due_on: 5.days.from_now.to_date) }

  it "inserts a pending cover_notice row and enqueues a send for each recipient" do
    expect { described_class.deliver(shift: shift, to: [ alice, bob ]) }
      .to have_enqueued_job(SendSmsJob).exactly(:twice)

    notices = SmsMessage.cover_notice.where(shift: shift)
    expect(notices.map(&:member)).to contain_exactly(alice, bob)
    expect(notices.map(&:status).uniq).to eq([ "pending" ])
    # A cover notice is not one of the shift's scheduled reminders, so it carries no offset.
    expect(notices.map(&:days_before).uniq).to eq([ nil ])
  end

  it "enqueues the created message's own id, so the job sends the right text" do
    described_class.deliver(shift: shift, to: [ bob ])

    notice = SmsMessage.cover_notice.find_by(shift: shift, member: bob)
    expect(SendSmsJob).to have_been_enqueued.with(notice.id)
  end

  it "skips a member it is not allowed to text rather than creating a doomed row" do
    opted_out = create(:member, :opted_out, group: group)

    expect { described_class.deliver(shift: shift, to: [ opted_out ]) }
      .not_to have_enqueued_job(SendSmsJob)

    expect(SmsMessage.cover_notice.where(shift: shift)).to be_empty
  end

  it "accepts a single member as well as a list" do
    expect { described_class.deliver(shift: shift, to: bob) }
      .to have_enqueued_job(SendSmsJob).exactly(:once)
  end
end
