# The operator's one lever over a house, and the one place to write down why it was pulled.
#
# Suspend rather than delete (the plan's own decision): deleting a house cascades through every
# shift it ever ran and needs the WorkOS organization deleted alongside it, while suspension is
# reversible, loses nothing, and covers both of the cases that actually come up — abuse, and a
# house running up a bill nobody is paying. Nothing reads these columns unless they are set, so the
# migration is inert on its own and previous code keeps running against it.
class AddSuspensionAndNotesToGroups < ActiveRecord::Migration[8.1]
  def change
    # NULL means live. The moment rather than a boolean, because "since when" is the first thing
    # asked about a paused house and a flag cannot answer it. Deliberately not indexed: `Group.live`
    # is only ever merged into a query that is already narrowed to one house or to the rotas of the
    # few dozen that exist, and an index on a column that is NULL for almost every row would be read
    # by nothing.
    add_column :groups, :suspended_at, :datetime, null: true

    # Operator-only, and structurally so: it appears in SuperAdmin::GroupSerializer and in no
    # house-facing serializer, which is why the two are separate classes rather than one with a
    # flag. "Trial house for the school run", "suspended for non-payment, emailed 14 Sep".
    add_column :groups, :notes, :text, null: true
  end
end
