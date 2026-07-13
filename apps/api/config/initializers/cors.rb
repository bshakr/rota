# Be sure to restart your server when you modify this file.
#
# The Next.js app calls this API from the browser. Auth travels as an
# `Authorization: Bearer <token>` header, never a cookie, so credentials stay off and
# there is no cookie/origin dance to get wrong.
#
# Allowed origins come from config.x.cors_origins — see config/application.rb.
#
# Read more: https://github.com/cyu/rack-cors

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    origins(*Rails.application.config.x.cors_origins)

    resource "*",
      headers: :any,
      methods: [ :get, :post, :put, :patch, :delete, :options, :head ],
      credentials: false,
      max_age: 600
  end
end
