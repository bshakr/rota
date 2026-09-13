# Building a house with a history, for the super admin specs.
#
# The operator's list is almost entirely counts over other tables, so its specs need houses that
# have actually done something — a rota with people on it, texts that went out last Tuesday, one
# that failed. These helpers put that together in the fewest lines that still go through the real
# models, so the counts under test are counted off rows the app itself would have written.
module SuperAdminHouses
  # A rota with people on it: what "running" means on the list, as against a rota nobody is on,
  # which is a draft.
  def running_rota(group, roster: 2, **attrs)
    rota = create(:rota, group: group, **attrs)
    roster.times { |index| create(:rota_position, rota: rota, member: create(:member, group: group), position: index) }
    rota
  end

  # One text in a house's log. `at` is the moment it happened, written straight onto the row
  # because `created_at` is what the seven-day window and the last-activity column both read.
  def text_in(group, status: "sent", at: Time.current, rota: nil, member: nil, due_on: nil, **attrs)
    rota ||= create(:rota, group: group)
    member ||= create(:member, group: group)
    due_on ||= Date.current + rota.shifts.count + 1
    shift = create(:shift, rota: rota, assigned_member: member, due_on: due_on)

    message = create(:sms_message, shift: shift, member: member, status: status,
      sent_at: (status == "sent" ? at : nil), **attrs)
    message.update_columns(created_at: at, updated_at: at)
    message
  end
end

RSpec.configure { |config| config.include SuperAdminHouses }
