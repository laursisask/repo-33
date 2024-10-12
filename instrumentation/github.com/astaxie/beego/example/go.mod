module go.opentelemetry.io/contrib/instrumentation/astaxie/beego/example

go 1.14

require (
	github.com/astaxie/beego v1.12.2
	go.opentelemetry.io/contrib/instrumentation/github.com/astaxie/beego v0.11.0
	go.opentelemetry.io/otel/exporters/stdout v0.11.0
	go.opentelemetry.io/otel/sdk v1.31.0
	go.opentelemetry.io/otel/sdk/export/metric v0.28.0 // indirect
)

replace (
	go.opentelemetry.io/contrib => ../../../../../
	go.opentelemetry.io/contrib/instrumentation/github.com/astaxie/beego => ../
	go.opentelemetry.io/contrib/instrumentation/net/http => ../../../../net/http
)
