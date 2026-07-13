require "rails_helper"

RSpec.describe Shift do
  # The one method. The reminder job, the calendar and the member page all call it, and it is
  # resolved at *send* time rather than at schedule time — which is why handing a shift on needs
  # no special reminder logic at all.
  describe "#responsible_member" do
    it "is the assigned member when nobody is covering" do
      shift = create(:shift)

      expect(shift.responsible_member).to eq(shift.assigned_member)
    end

    it "is the covering member when someone is" do
      shift = create(:shift, :covered)

      expect(shift.responsible_member).to eq(shift.covering_member)
      expect(shift.responsible_member).not_to eq(shift.assigned_member)
    end

    it "goes back to the assigned member when the cover is cancelled" do
      shift = create(:shift, :covered)

      shift.update!(covering_member: nil)

      expect(shift.responsible_member).to eq(shift.assigned_member)
    end

    it "follows the shift when it is handed on again" do
      shift = create(:shift, :covered)
      cara = create(:member, group: shift.rota.group)

      shift.update!(covering_member: cara)

      expect(shift.responsible_member).to eq(cara)
    end
  end

  describe "#covered?" do
    it "is false without a cover" do
      expect(create(:shift)).not_to be_covered
    end

    it "is true with a cover" do
      expect(create(:shift, :covered)).to be_covered
    end
  end

  describe "validations" do
    it "is valid with the factory" do
      expect(build(:shift)).to be_valid
    end

    it "requires a due date" do
      shift = build(:shift, due_on: nil)

      expect(shift).not_to be_valid
      expect(shift.errors[:due_on]).to be_present
    end

    it "refuses a second shift for the same rota on the same day" do
      shift = create(:shift)
      duplicate = build(:shift, rota: shift.rota, due_on: shift.due_on)

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:due_on]).to be_present
    end

    it "allows two rotas to fall due on the same day" do
      shift = create(:shift)

      expect(build(:shift, due_on: shift.due_on)).to be_valid
    end

    it "refuses a cover by the member who is already assigned" do
      shift = create(:shift)
      shift.covering_member = shift.assigned_member

      expect(shift).not_to be_valid
      expect(shift.errors[:covering_member]).to be_present
    end

    # Tenancy, one level below the request: no cover may hand a turn to a stranger in another
    # house, whatever a compromised frontend asks for.
    it "refuses an assigned member from another group" do
      shift = build(:shift, assigned_member: create(:member))

      expect(shift).not_to be_valid
      expect(shift.errors[:assigned_member]).to be_present
    end

    it "refuses a covering member from another group" do
      shift = build(:shift, covering_member: create(:member))

      expect(shift).not_to be_valid
      expect(shift.errors[:covering_member]).to be_present
    end
  end

  describe ".upcoming" do
    it "takes today's shifts and later, but not the past" do
      rota = create(:rota)
      today = create(:shift, rota: rota, due_on: Date.current)
      future = create(:shift, rota: rota, due_on: 3.days.from_now.to_date)
      create(:shift, :past, rota: rota)

      expect(rota.shifts.upcoming).to contain_exactly(today, future)
    end
  end

  it "takes its messages with it when destroyed" do
    message = create(:sms_message)

    expect { message.shift.destroy! }.to change(SmsMessage, :count).by(-1)
  end
end
