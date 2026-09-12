# A demo group, so the app is clickable from minute one. Idempotent: re-running changes nothing,
# and in particular never rotates a member's access token, because that token is their magic link.
#
# No shifts are seeded. Shifts are generated from a rota by ShiftGenerator, and inventing rows
# here would mean inventing them by a different rule than the one the app actually uses.

# Demo data has no business in a production database — "Flat 4, Alma Road" is not a real house,
# and the numbers below are real, dialable UK mobiles that may well belong to someone. There is no
# such thing as a fictional-but-valid phone number: Ofcom reserves the drama range (07700 900xxx)
# precisely so that it can never connect, which is why libphonenumber rejects it and so does
# Member. The numbers therefore have to be plausible, and this guard is what keeps them harmless.
#
# `return`, not `exit`: seeds are loaded *into* the `db:prepare` process, so exiting here would
# take that whole process down and silently skip whatever a deploy runs next.
if Rails.env.production?
  puts "Skipping demo seeds in production."
  return
end

group = Group.find_or_create_by!(workos_organization_id: "org_demo_flat_4") do |g|
  g.name = "Flat 4, Alma Road"
  g.timezone = "Europe/London"
end

ciara, bass, eliza, raph = [
  [ "Ciara", "+447400123001" ],
  [ "Bass",  "+447400123002" ],
  [ "Eliza", "+447400123003" ],
  [ "Raph",  "+447400123004" ]
].map do |name, phone|
  group.members.find_or_create_by!(name: name) { |member| member.phone_e164 = phone }
end

kitchen = group.rotas.find_or_create_by!(name: "Kitchen deep clean") do |rota|
  rota.message_template =
    "Hi {{name}} 🌷 you're up for {{rota}} on {{date}} ({{days_until}}). Can't make it? Tap to hand it on."
  rota.starts_on = Date.current.next_occurring(:saturday)
  rota.interval_count = 1
  rota.interval_unit = "week"
  rota.send_hour = 9
  # Three days' warning, then a nudge on the day.
  rota.reminder_offsets = [ 3, 0 ]
end

bins = group.rotas.find_or_create_by!(name: "Bins out") do |rota|
  rota.message_template = "{{name}}, it's your turn for {{rota}} tomorrow ({{date}}). Black bin and recycling."
  rota.starts_on = Date.current.next_occurring(:tuesday)
  rota.interval_count = 2
  rota.interval_unit = "week"
  rota.send_hour = 18
  # One evening's warning is all anyone needs to move a bin.
  rota.reminder_offsets = [ 1 ]
end

# Everyone takes a turn at the kitchen...
[ ciara, bass, eliza, raph ].each_with_index do |member, position|
  kitchen.rota_positions.find_or_create_by!(member: member) { |p| p.position = position }
end

# ...but the bins are only Bass and Eliza's, because a rota's roster is its own ordered subset of
# the group, not the whole house.
[ bass, eliza ].each_with_index do |member, position|
  bins.rota_positions.find_or_create_by!(member: member) { |p| p.position = position }
end

puts "Seeded #{group.name}: #{group.members.count} members, #{group.rotas.count} rotas."
group.members.each { |m| puts "  #{m.name.ljust(6)} #{m.phone_e164}  /s/#{m.access_token}" }
