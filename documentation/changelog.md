#### 2.0.1-alpha - 15-11-2018 

* [CONJS-52] (Bug) Commit not executed when in transaction and autocommit is enabled
* [CONJS-50] (Bug) race condition when using authentication plugins
* [CONJS-21] add bulk insert method
* [CONJS-38] Add connection reset
* [CONJS-41] Handle multiple server pools with failover capabilities
* [CONJS-49] test connector with maxscale
* [CONJS-51] Permit use of connection string to provide options
* [CONJS-48] Add option to permit query command when establishing a connection

#### 2.0.0-alpha - 20-09-2018 

* [CONJS-42] check other connections in pool when an unexpected connection error occur
* [CONJS-44] Create option to permit setting Object to one prepareStatement parameter
* [CONJS-43] Callback API is missing
* [CONJS-39] support geometric GeoJSON structure format
* [CONJS-24] new option "sessionVariables" to permit setting session variable at connection
* [misc] connection.end() immediate resolution on socket QUIT packet send.
* [misc] improve documentation and set Promise API documentation to a dedicated page.
* [misc] change pool implementation to permit node 6 compatibility (removal of async await)
 

#### 0.7.0 - 18-07-2018 

* First alpha version 
