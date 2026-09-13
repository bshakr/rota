require "rails_helper"

# The counts themselves are exercised through the list they feed
# (spec/requests/super_admin/groups_spec.rb). What is here is the one invariant that spec cannot
# see: that the two halves of "a text was attempted" between them still account for every status a
# text can be in.
RSpec.describe SuperAdmin::GroupStats do
  it "sorts every SMS status into either attempted or unsent, with none left over" do
    sorted = described_class::ATTEMPTED_STATUSES + described_class::UNSENT_STATUSES

    expect(sorted).to match_array(SmsMessage::STATUSES.values)
  end

  it "counts a staffed rota as staffed whether or not it is switched on" do
    row = described_class::Row.empty.with(running_rotas: 2, paused_rotas: 3)

    expect(row.staffed_rotas).to eq(5)
  end
end
