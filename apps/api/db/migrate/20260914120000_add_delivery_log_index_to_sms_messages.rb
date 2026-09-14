# The index the delivery log actually reads (BLO-1698).
#
# Api::SmsMessagesController#index reaches the texts through the group's members, so the query is
#
#   SELECT sms_messages.* FROM sms_messages INNER JOIN members ON members.id = sms_messages.member_id
#   WHERE members.group_id = $1 AND sms_messages.status = 'failed'
#   ORDER BY sms_messages.created_at DESC, sms_messages.id DESC LIMIT 100
#
# and the only index it could use was the plain one on member_id. Postgres therefore read EVERY text
# each member of the house had ever received, threw away the ones with the wrong status in the heap,
# sorted what survived and only then took the first hundred. On a house with 20,000 texts that is
# 4,611 buffers to return 80 rows, and it gets worse every month the house keeps texting.
#
# The column order is the query's own: member_id is the join key the nested loop drives on, status is
# the only other equality, and (created_at DESC, id DESC) is the ORDER BY spelled exactly as the
# controller writes it. `id` is in there because the controller really does order by it: it is the
# tiebreaker that stops two texts written in the same millisecond from swapping places between two
# requests.
#
# What that buys, stated honestly. The win is the status column being IN the index: the texts that
# did not fail are never visited in the heap at all, and the buffers above are almost entirely that.
# The sort is NOT free. Each member's slice comes back from the index already in (created_at DESC,
# id DESC) order, but the plan walks the house's members one at a time and Postgres still has to
# order those slices against each other, so a Sort node stays in the plan. What it sorts is the
# failures rather than every text the house has ever been sent, which is the whole difference.
#
# CONCURRENTLY, because sms_messages has real rows in production and a plain CREATE INDEX takes an
# ACCESS EXCLUSIVE lock that would stall every reminder send for the duration. That needs the
# migration to run outside a transaction, hence disable_ddl_transaction!. The name is given rather
# than derived: the generated one is 64 characters and Postgres truncates at 63.
#
# What CONCURRENTLY costs is its failure mode. A build that fails partway leaves the index in place
# and marked INVALID: it is not used by any query, it is still maintained on every write, and it
# holds the name, so re-running this migration raises instead of repairing it. Drop it first, and
# concurrently as well, outside a transaction:
#
#   DROP INDEX CONCURRENTLY index_sms_messages_on_delivery_log;
class AddDeliveryLogIndexToSmsMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_index :sms_messages,
      [ :member_id, :status, :created_at, :id ],
      order: { created_at: :desc, id: :desc },
      name: "index_sms_messages_on_delivery_log",
      algorithm: :concurrently
  end
end
