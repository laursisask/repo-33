module go.opentelemetry.io/contrib/instrumentation/go.mongodb.org/mongo-driver

go 1.13

replace go.opentelemetry.io/contrib => ../../..

require (
	github.com/kr/pretty v0.1.0 // indirect
	github.com/stretchr/testify v1.6.1
	go.mongodb.org/mongo-driver v1.17.1
	go.opentelemetry.io/contrib v0.11.0
	go.opentelemetry.io/otel v0.12.0
	gopkg.in/check.v1 v1.0.0-20180628173108-788fd7840127 // indirect
)
