
module.exports = function(RED) {
    "use strict";
    var Pigpio = require('pigpio-client');

    var bcm2pin = {
        "2":"3", "3":"5", "4":"7", "14":"8", "15":"10", "17":"11", "18":"12", "27":"13", "22":"15",
        "23":"16", "24":"18", "10":"19", "9":"21", "25":"22", "11":"23", "8":"24", "7":"26",
        "5":"29", "6":"31", "12":"32", "13":"33", "19":"35", "16":"36", "26":"37", "20":"38", "21":"40"
    };
    var pinTypes = {
        "PUD_OFF":RED._("pi-gpiod:types.input"),
        "PUD_UP":RED._("pi-gpiod:types.pullup"),
        "PUD_DOWN":RED._("pi-gpiod:types.pulldown"),
        "out":RED._("pi-gpiod:types.digout"),
        "pwm":RED._("pi-gpiod:types.pwmout"),
        "ser":RED._("pi-gpiod:types.servo")
    };

    function GPioInNode(n) {
        RED.nodes.createNode(this,n);
        this.host = n.host || "127.0.0.1";
        this.port = n.port || 8888;
        this.pin = n.pin;
        this.pio = bcm2pin[n.pin];
        this.intype = n.intype;
        this.read = n.read || false;
        this.debounce = Number(n.debounce || 25);

        var inputTypes = {  "PUD_OFF": 0,
                            "PUD_DOWN": 1,
                            "PUD_UP": 2};
        var node = this;
        var PiGPIO;

        if (node.pin !== undefined) {
            try{
                PiGPIO = new Pigpio.pigpio({host: this.host, post: this.port, timeout: null} );
                const ready = new Promise((resolve, reject) => {
                    PiGPIO.once('connected', resolve);
                    PiGPIO.once('error', reject);
                });
                            
                var inerror = false;
                var doit = async function() {
                    try{
                        node.pigpioPin = PiGPIO.gpio(Number(node.pin));
                        inerror = false;
                        await node.pigpioPin.modeSet('input');
                        await node.pigpioPin.pullUpDown(inputTypes[node.intype]);
                        await node.pigpioPin.glitchSet(node.debounce);
                        
                        node.status({fill:"green",shape:"dot",text:"node-red:common.status.ok"});
                        node.pigpioPin.notify(function(level, tick) {
                            node.send({ topic:"pi/" + node.pio, payload:Number(level) });
                            node.status({fill:"green",shape:"dot",text:level});
                        });
                        if (node.read) {
                            setTimeout(function() {
                                node.pigpioPin.read(function(err, level) {
                                    node.send({ topic:"pi/"+node.pio, payload:Number(level) });
                                    node.status({fill:"green",shape:"dot",text:level});
                                });
                            }, 20);
                        }
                    }
                    catch (error) {
                        node.status({fill:"red", shape:"ring", text:error + " " + node.host + ":" + node.port});
                        if (!inerror) { node.error(error); inerror = true; }
                        node.retry = setTimeout(function() { doit(); }, 5000);
                        
                    }
                }
                ready.then(doit);
            }
            catch (error) { // from creating PIGPIO 
                node.status({fill:"red", shape:"ring", text:error + " " + node.host + ":" + node.port});
                if (!inerror) { node.error(error); inerror = true; }
                node.retry = setTimeout(function() { doit(); }, 5000);
            }
        }
        else {
            node.warn(RED._("pi-gpiod:errors.invalidpin") + ": " + node.pio);
        }

        node.on("close", function(done) {
            if (node.retry) { clearTimeout(node.retry); }
            node.status({fill:"grey",shape:"ring",text:"pi-gpiod.status.closed"});
            if(node.pigpioPin){
                node.pigpioPin.endNotify();
            }
            PiGPIO.end();
            done();
        });
    }
    RED.nodes.registerType("pi-gpiod in",GPioInNode);


    function GPioOutNode(n) {
        RED.nodes.createNode(this,n);
        this.host = n.host || "127.0.0.1";
        this.port = n.port || 8888;
        this.pin = n.pin;
        this.pio = bcm2pin[n.pin];
        this.set = n.set || false;
        this.level = parseInt(n.level || 0);
        this.out = n.out || "out";
        this.sermin = Number(n.sermin)/100;
        this.sermax = Number(n.sermax)/100;
        if (this.sermin > this.sermax) {
            var tmp = this.sermin;
            this.sermin = this.sermax;
            this.sermax = tmp;
        }
        if (this.sermin < 5) { this.sermin = 5; }
        if (this.sermax > 25) { this.sermax = 25; }
        var node = this;
        var PiGPIO;

        function inputlistener(msg) {
            if (node.out === "ser" && (msg.payload === null || msg.payload === "")) {
                if (!inerror) {
                    PiGPIO.setServoPulsewidth(node.pin, 0);
                    node.status({fill:"green",shape:"dot",text:""});
                }
                else { node.status({fill:"grey",shape:"ring",text:"N/C: " + msg.payload.toString()}); }
            }
            else {
                if (msg.payload === "true") { msg.payload = true; }
                if (msg.payload === "false") { msg.payload = false; }
                var out = Number(msg.payload);
                var limit = 1;
                if (node.out !== "out") { limit = 100; }
                var pre = "";
                if ((out >= 0) && (out <= limit)) {
                    if (RED.settings.verbose) { node.log("out: "+msg.payload); }
                    
                    if (node.pigpioPin && !inerror) {
                        if (node.out === "out") {
                            node.pigpioPin.write(out);
                        }
                        if (node.out === "pwm") {
                            node.pigpioPin.analogWrite(parseInt(out * 2.55));
                        }
                        if (node.out === "ser") {
                            var r = (node.sermax - node.sermin) * 100;
                            node.pigpioPin.setServoPulsewidth(parseInt(1500 - (r/2) + (out * r / 100)));
                        }
                        node.status({fill:"green",shape:"dot",text:out.toString()});
                    }
                    else {
                        node.status({fill:"grey",shape:"ring",text:"N/C: " + out.toString()});
                    }
                }
                else { node.warn(RED._("pi-gpiod:errors.invalidinput")+": "+out); }
            }
        }

        var PiGPIO;

        if (node.pin !== undefined) {
            try{
                PiGPIO = new Pigpio.pigpio({host: this.host, post: this.port, timeout: null} );
                const ready = new Promise((resolve, reject) => {
                    PiGPIO.once('connected', resolve);
                    PiGPIO.once('error', reject);
                });
                
                var inerror = false;
                var doit = async function() {
                    try{
                        node.pigpioPin = PiGPIO.gpio(Number(node.pin));
                        inerror = false;
                        await node.pigpioPin.modeSet('output');
                        var err = false; // replace with catch
                        if (err) {
                        }
                        if (node.set) {
                            setTimeout(function() { node.pigpioPin.write(node.level); }, 25 );
                            node.status({fill:"green",shape:"dot",text:node.level});
                        } else {
                            node.status({fill:"green",shape:"dot",text:"node-red:common.status.ok"});
                        }
                        // if (node.out === "pwm") {
                        //     PiGPIO.set_PWM_frequency(1000);
                        //     PiGPIO.set_PWM_range(1000);
                        // }
                    }
                    catch (error) {
                        node.status({fill:"red",shape:"ring",text:error.code+" "+node.host+":"+node.port});
                        if (!inerror) { node.error(err,err); inerror = true; }
                        node.retry = setTimeout(function() { doit(); }, 5000);
                    }
                }
                
                doit();
                node.on("input", inputlistener);
            }
            catch(error) {
                node.warn(RED._("pi-gpiod:errors.invalidpin")+": "+node.pio);
            }
        }
        
        node.on("close", function(done) {
            if (node.retry) { clearTimeout(node.retry); }
            node.status({fill:"grey",shape:"ring",text:"pi-gpiod.status.closed"});
            PiGPIO.end();
            done();
        });
    }
    RED.nodes.registerType("pi-gpiod out",GPioOutNode);
}

