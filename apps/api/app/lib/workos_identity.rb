# What WorkOS knows about a *person*, as opposed to what a token says about a *request*.
#
# WorkosAccessToken reads a token; this reads a profile. Two unrelated places hand us the same three
# fields and neither is the token: the AuthKit session, which the web app forwards on
# POST /api/sign_ins, and the WorkOS directory, which lib/tasks/users.rake asks directly. Both have
# to turn those fields into a `users` row the same way, so the rule for "what is this person called,
# and how do we reach them" lives here once rather than twice.
#
# Nothing here trusts anything. It normalises, and that is all — see User#absorb_workos_identity!
# for what may actually be written with the result.
class WorkosIdentity
  # `users.email` and `users.name` are unbounded varchars, and one of the two sources for this is a
  # request body. A name is a name; nothing legitimate is longer than this, and a row is not the
  # place to find out.
  MAX_LENGTH = 255

  # The address WorkOS holds, or nil. Never blank, never whitespace.
  attr_reader :email

  # "First Last", or whichever half exists, or nil when neither does. Never blank.
  attr_reader :name

  # Whitespace is not a value: WorkOS returns "" and nil for the same absence depending on which
  # signup form left the field empty, and a name assembled from two of those must be nothing rather
  # than a space.
  def initialize(email: nil, first_name: nil, last_name: nil)
    @email = normalize(email)
    @name = [ normalize(first_name), normalize(last_name) ].compact.join(" ").presence&.first(MAX_LENGTH)
  end

  # The three fields as the web app posts them, taken from request params.
  #
  # Only actual strings are read. A caller who posts `email: {"$ne": null}` or `first_name: [1, 2]`
  # gets an ActionController::Parameters or an Array here, and this turns every one of those into
  # nil rather than into something `update!` would be asked to store.
  def self.from_params(params)
    new(
      email: string(params[:email]),
      first_name: string(params[:first_name]),
      last_name: string(params[:last_name])
    )
  end

  def self.string(value) = value.is_a?(String) ? value : nil
  private_class_method :string

  # Whether WorkOS told us anything at all. A sign-in from a session with neither half is not an
  # error — it is simply nothing to write.
  def any? = email.present? || name.present?

  private

  def normalize(value)
    return nil unless value.is_a?(String)

    value.strip.presence&.first(MAX_LENGTH)
  end
end
