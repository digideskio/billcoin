
	// Make opcodes available as pseudo-constants
	for (var i in Opcode.map) {
		eval("var " + i + " = " + Opcode.map[i] + ";");
	}

	var isArray = function(o) {
		return Object.prototype.toString.call(o) === '[object Array]';
	}

	var stringToBytes = function (str) {
		for (var bytes = [], i = 0; i < str.length; i++)
			bytes.push(str.charCodeAt(i));
		return bytes;
	}

	var base64ToBytes = function(base64) {
			// Use browser-native function if it exists
			if (typeof atob == "function") return stringToBytes(atob(base64));

			// Remove non-base-64 characters
			base64 = base64.replace(/[^A-Z0-9+\/]/ig, "");

			for (var bytes = [], i = 0, imod4 = 0; i < base64.length; imod4 = ++i % 4) {
				if (imod4 == 0) continue;
				bytes.push(((base64map.indexOf(base64.charAt(i - 1)) & (Math.pow(2, -2 * imod4 + 8) - 1)) << (imod4 * 2)) |
				           (base64map.indexOf(base64.charAt(i)) >>> (6 - imod4 * 2)));
			}

			return bytes;
	}

	var Script = function (data) {
		if (!data) {
			this.buffer = [];
		} else if ("string" == typeof data) {
			this.buffer = base64ToBytes(data);
		} else if (isArray(data)) {
			this.buffer = data;
		} else if (data instanceof Script) {
			this.buffer = data.buffer;
		} else {
			throw new Error("Invalid script");
		}

		this.parse();
	};

	Script.prototype.parse = function () {
		var self = this;

		this.chunks = [];

		// Cursor
		var i = 0;
		
		// Read n bytes and store result as a chunk
		function readChunk(n) {
			self.chunks.push(self.buffer.slice(i, i + n));
			i += n;
		};

		while (i < this.buffer.length) {
			var opcode = this.buffer[i++];
			if (opcode >= 0xF0) {
				// Two byte opcode
				opcode = (opcode << 8) | this.buffer[i++];
			}

			var len;
			if (opcode > 0 && opcode < OP_PUSHDATA1) {
				// Read some bytes of data, opcode value is the length of data
				readChunk(opcode);
			} else if (opcode == OP_PUSHDATA1) {
				len = this.buffer[i++];
				readChunk(len);
			} else if (opcode == OP_PUSHDATA2) {
				len = (this.buffer[i++] << 8) | this.buffer[i++];
				readChunk(len);
			} else if (opcode == OP_PUSHDATA4) {
				console.debug(opcode);
				len = (this.buffer[i++] << 24) |
				      (this.buffer[i++] << 16) |
				      (this.buffer[i++] << 8) |
				      this.buffer[i++];
				readChunk(len);
			} else {
				this.chunks.push(opcode);
			}
		}
	};

	Script.prototype.getOutType = function ()
	{
		if (this.chunks.length == 5 &&
			this.chunks[0] == OP_DUP &&
			this.chunks[1] == OP_HASH160 &&
			this.chunks[3] == OP_EQUALVERIFY &&
			this.chunks[4] == OP_CHECKSIG) {

			// Transfer to Bitcoin address
			return 'Address';
		} else if (this.chunks.length == 2 &&
				   this.chunks[1] == OP_CHECKSIG) {

			// Transfer to IP address
			return 'Pubkey';
		} else {
			return 'Strange';
		}
	};

	Script.prototype.simpleOutPubKeyHash = function ()
	{
		var ripemd160 = new Ripemd160();
		var sha256 = new Sha256();

		switch (this.getOutType()) {
		case 'Address':
			return this.chunks[2];
		case 'Pubkey':
			return ripemd160.generate(sha256.generate(this.chunks[0],{asBytes:true}),{asBytes:false});
			//return Bitcoin.Util.sha256ripe160(this.chunks[0]);
		default:
			throw new Error("Encountered non-standard scriptPubKey");
		}
	};

	Script.prototype.getInType = function ()
	{
		if (this.chunks.length == 1) {
			// Direct IP to IP transactions only have the public key in their scriptSig.
			return 'Pubkey';
		} else if (this.chunks.length == 2 &&
				   isArray(this.chunks[0]) &&
				   isArray(this.chunks[1])) {
			return 'Address';
		} else {
			throw new Error("Encountered non-standard scriptSig");
		}
	};

	Script.prototype.simpleInPubKey = function ()
	{
		switch (this.getInType()) {
		case 'Address':
			return this.chunks[1];
		case 'Pubkey':
			return this.chunks[0];
		default:
			throw new Error("Encountered non-standard scriptSig");
		}
	};

	Script.prototype.simpleInPubKeyHash = function ()
	{
		var ripemd160 = new Ripemd160();
		var sha256 = new Sha256();

		return ripemd160.generate(sha256.generate(this.simpleInPubKey(),{asBytes:true}),{asBytes:false});
		//return Bitcoin.Util.sha256ripe160(this.simpleInPubKey());
	};

	Script.prototype.writeOp = function (opcode)
	{
		this.buffer.push(opcode);
		this.chunks.push(opcode);
	};

	Script.prototype.writeBytes = function (data)
	{
		if (data.length < OP_PUSHDATA1) {
			this.buffer.push(data.length);
		} else if (data.length <= 0xff) {
			this.buffer.push(OP_PUSHDATA1);
			this.buffer.push(data.length);
		} else if (data.length <= 0xffff) {
			this.buffer.push(OP_PUSHDATA2);
			this.buffer.push(data.length & 0xff);
			this.buffer.push((data.length >>> 8) & 0xff);
		} else {
			this.buffer.push(OP_PUSHDATA4);
			this.buffer.push(data.length & 0xff);
			this.buffer.push((data.length >>> 8) & 0xff);
			this.buffer.push((data.length >>> 16) & 0xff);
			this.buffer.push((data.length >>> 24) & 0xff);
		}
		this.buffer = this.buffer.concat(data);
		this.chunks.push(data);
	};

	Script.createOutputScript = function (address)
	{
		var script = new Script();
		script.writeOp(OP_DUP);
		script.writeOp(OP_HASH160);
		script.writeBytes(address.hash);
		script.writeOp(OP_EQUALVERIFY);
		script.writeOp(OP_CHECKSIG);
		return script;
	};

	Script.createInputScript = function (signature, pubKey)
	{
		var script = new Script();
		script.writeBytes(signature);
		script.writeBytes(pubKey);
		return script;
	};

	Script.prototype.clone = function ()
	{
		return new Script(this.buffer);
	};

Script.prototype.getToAddress = function() {
  var outType = this.getOutType()

  if (outType == 'Pubkey') {
    return new BitcoinAddress(this.chunks[2])
  }

  if (outType == 'P2SH') {
    return new BitcoinAddress(this.chunks[1], 5)
  }

  return new BitcoinAddress(this.chunks[1], 5)
}