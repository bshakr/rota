require "rails_helper"

# The reminder sweep is the heart of the app, so it is tested at the level it actually runs: a
# frozen wall clock (`travel_to`) and real rows, asserting what the sweep did or refused to do at
# that instant. Every assertion is scoped to the shift under test — the sweep scans ALL active
# rotas, so a global `SmsMessage.count` would answer about the whole world, not this example.
RSpec.describe ReminderSweep do
  include ActiveSupport::Testing::TimeHelpers
  include ActiveJob::TestHelper

  # London, so "9am" is a real timezone question and not an accident of the server also being UTC.
  # In July the offset is BST (+1), so 09:00 local is 08:00 UTC — the gap that proves the sweep uses
  # the group's clock rather than the server's.
  let(:group) { create(:group, timezone: "Europe/London") }
  let(:rota) do
    create(:rota, group: group, send_hour: 9, reminder_offsets: [ 3, 0 ])
  end

  def sweep
    described_class.new(rota).call
  end

  def reminder_for(shift, days_before)
    shift.sms_messages.reminder.find_by(days_before: days_before)
  end

  describe "the send moment is the group's local hour, not the server's" do
    # due 17 Jul, so the 3-day reminder's send date is 14 Jul: 09:00 BST == 08:00 UTC.
    let!(:shift) { create(:shift, rota: rota, due_on: Date.new(2026, 7, 17)) }

    it "does not send before the local send hour" do
      travel_to(Time.utc(2026, 7, 14, 7, 59)) do # 08:59 BST, one minute early
        expect { sweep }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 3)).to be_nil
      end
    end

    it "sends once the local send hour arrives" do
      # 08:00 UTC is 09:00 BST. Under a naive UTC reading the moment would still be an hour away, so
      # a row here is proof the group's zone is the one in force.
      travel_to(Time.utc(2026, 7, 14, 8, 0)) do
        expect { sweep }.to have_enqueued_job(SendSmsJob)

        reminder = reminder_for(shift, 3)
        expect(reminder).to have_attributes(status: "pending", kind: "reminder", days_before: 3)
        expect(reminder.member).to eq(shift.responsible_member)
      end
    end
  end

  describe "each configured offset, including the day-of (0)" do
    let!(:shift) { create(:shift, rota: rota, due_on: Date.new(2026, 7, 17)) }

    it "sends the day-of reminder at the shift's own send hour" do
      # 17 Jul 09:00 BST. The 3-day reminder's moment (14 Jul) is three days gone and stays buried by
      # the staleness guard, so the only thing due now is offset 0.
      travel_to(Time.utc(2026, 7, 17, 8, 0)) do
        expect { sweep }.to have_enqueued_job(SendSmsJob)

        expect(reminder_for(shift, 0)).to be_present
        expect(reminder_for(shift, 3)).to be_nil
      end
    end
  end

  describe "self-healing after an outage" do
    let!(:shift) { create(:shift, rota: rota, due_on: Date.new(2026, 7, 17)) }

    it "still sends when the worker was down at the exact send hour" do
      # The 3-day moment is 14 Jul 08:00 UTC. Nothing swept then — the worker was down. Three hours
      # later the reconciliation notices the gap and sends. A trigger firing only on the hour would
      # have dropped this reminder for good.
      travel_to(Time.utc(2026, 7, 14, 11, 0)) do
        expect { sweep }.to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 3)).to be_present
      end
    end
  end

  describe "the staleness guard" do
    it "refuses a reminder whose moment passed more than 24 hours ago" do
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 17))

      # The 3-day moment was 14 Jul 08:00 UTC; 15 Jul 09:00 UTC is 25 hours past it.
      travel_to(Time.utc(2026, 7, 15, 9, 0)) do
        expect { sweep }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 3)).to be_nil
      end
    end

    it "does not fire a freshly-added far offset for an imminent shift" do
      # The spec's motivating case: add a 7-day reminder to a rota whose next shift is two days out.
      # Its send moment is five days in the past, so it must stay buried rather than blurt out
      # "7 days to go!" about a shift that is nearly here.
      travel_to(Time.utc(2026, 7, 14, 12, 0)) do
        far = create(:rota, group: group, send_hour: 9, reminder_offsets: [ 7 ])
        shift = create(:shift, rota: far, due_on: group.today + 2)

        expect { described_class.new(far).call }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 7)).to be_nil
      end
    end
  end

  describe "idempotency" do
    let!(:shift) { create(:shift, rota: rota, due_on: Date.new(2026, 7, 17)) }

    it "creates exactly one row when the same sweep runs twice" do
      travel_to(Time.utc(2026, 7, 14, 8, 0)) do
        sweep
        expect { sweep }.not_to have_enqueued_job(SendSmsJob)

        expect(shift.sms_messages.reminder.where(days_before: 3).count).to eq(1)
      end
    end

    it "swallows the unique-index violation when two sweeps race" do
      # Concurrency the pre-check cannot see: two sweeps each read an empty set of claimed reminders
      # before either commits. The partial unique index on (shift_id, days_before) is the real
      # backstop — the loser's INSERT is rejected, and the sweep must treat that as a no-op, not an
      # error. Stubbing the claimed-set to empty reproduces that window against the real index.
      travel_to(Time.utc(2026, 7, 14, 8, 0)) do
        create(:sms_message, shift: shift, days_before: 3, member: shift.responsible_member)

        racing = described_class.new(rota)
        allow(racing).to receive(:claimed_reminders).and_return(Set.new)

        expect { racing.call }.not_to raise_error
        expect { racing.call }.not_to have_enqueued_job(SendSmsJob)
        expect(shift.sms_messages.reminder.where(days_before: 3).count).to eq(1)
      end
    end
  end

  describe "daylight saving time" do
    # A rota that texts at 1am — the awkward hour that a DST change either skips or repeats.
    let(:rota) { create(:rota, group: group, send_hour: 1, reminder_offsets: [ 0 ]) }

    it "does not double-send across a repeated local hour (clocks fall back)" do
      # 25 Oct 2026: 02:00 BST falls back to 01:00 GMT, so 01:00 local happens twice — once at
      # 00:00 UTC, once at 01:00 UTC. `local` resolves to the earlier instant, so both sweeps compute
      # the same moment and the second finds the reminder already claimed.
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 10, 25))

      travel_to(Time.utc(2026, 10, 25, 0, 30)) { sweep } # first 01:xx local
      travel_to(Time.utc(2026, 10, 25, 1, 30)) { sweep } # the repeated 01:xx local

      expect(shift.sms_messages.reminder.where(days_before: 0).count).to eq(1)
    end

    it "still sends across a skipped local hour (clocks spring forward)" do
      # 29 Mar 2026: 01:00 GMT springs to 02:00 BST, so 01:00 local never happens. `local` shifts it
      # forward to the real 02:00 BST instant (01:00 UTC), and the sweep after that still sends — a
      # skipped send hour must not silently swallow the reminder.
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 3, 29))

      travel_to(Time.utc(2026, 3, 29, 1, 30)) do
        expect { sweep }.to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 0)).to be_present
      end
    end
  end

  describe "resolving the recipient at send time" do
    it "texts the cover, not the assignee, after a handover" do
      # responsible_member is covering_member || assigned_member, resolved here at send time — which
      # is exactly why a handover needs no reminder to be rescheduled.
      cover = create(:member, group: group)
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 17), covering_member: cover)

      travel_to(Time.utc(2026, 7, 17, 8, 0)) do
        expect { sweep }.to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 0).member).to eq(cover)
      end
    end
  end

  describe "who the sweep will not text" do
    it "skips an inactive assignee, leaving no row so they can be re-included later" do
      assignee = create(:member, :inactive, group: group)
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 17), assigned_member: assignee)

      travel_to(Time.utc(2026, 7, 17, 8, 0)) do
        expect { sweep }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 0)).to be_nil
      end
    end

    it "skips an opted-out assignee" do
      assignee = create(:member, :opted_out, group: group)
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 17), assigned_member: assignee)

      travel_to(Time.utc(2026, 7, 17, 8, 0)) do
        expect { sweep }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 0)).to be_nil
      end
    end

    it "checks the resolved recipient: an opted-out cover is skipped even when the assignee is fine" do
      cover = create(:member, :opted_out, group: group)
      shift = create(:shift, rota: rota, due_on: Date.new(2026, 7, 17), covering_member: cover)

      travel_to(Time.utc(2026, 7, 17, 8, 0)) do
        expect { sweep }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 0)).to be_nil
      end
    end
  end

  describe "never for a past shift" do
    it "does not send a day-of reminder for a shift that is already in the past" do
      # due yesterday, send hour 23: the moment is only 8 hours ago, so the staleness guard alone
      # would let it through. It is the "shift in the past" rule that stops it.
      past_rota = create(:rota, group: group, send_hour: 23, reminder_offsets: [ 0 ])

      travel_to(Time.utc(2026, 7, 14, 6, 0)) do # 07:00 BST on the 14th
        shift = create(:shift, rota: past_rota, due_on: group.today - 1)

        expect { described_class.new(past_rota).call }.not_to have_enqueued_job(SendSmsJob)
        expect(reminder_for(shift, 0)).to be_nil
      end
    end
  end

  describe "a rota with no reminders configured" do
    it "does nothing" do
      quiet = create(:rota, group: group, reminder_offsets: [])
      shift = create(:shift, rota: quiet, due_on: Date.new(2026, 7, 17))

      travel_to(Time.utc(2026, 7, 17, 8, 0)) do
        expect { described_class.new(quiet).call }.not_to have_enqueued_job(SendSmsJob)
        expect(shift.sms_messages).to be_empty
      end
    end
  end
end
