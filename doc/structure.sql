CREATE TABLE `address` (
  `_id` bigint(20) UNSIGNED NOT NULL,
  `type` tinyint(3) UNSIGNED NOT NULL,
  `data` varbinary(32) NOT NULL,
  `string` varchar(64) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `create_height` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `balance_change` (
  `transaction_id` bigint(20) UNSIGNED NOT NULL,
  `block_height` int(10) UNSIGNED NOT NULL,
  `index_in_block` int(10) UNSIGNED NOT NULL,
  `address_id` bigint(20) UNSIGNED NOT NULL,
  `value` bigint(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `block` (
  `hash` binary(32) NOT NULL,
  `height` int(10) UNSIGNED NOT NULL,
  `size` int(10) UNSIGNED NOT NULL,
  `weight` int(10) UNSIGNED NOT NULL,
  `miner_id` bigint(20) UNSIGNED NOT NULL,
  `transactions_count` int(10) UNSIGNED NOT NULL,
  `contract_transactions_count` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `contract` (
  `address` binary(20) NOT NULL,
  `address_string` char(40) CHARACTER SET utf8 COLLATE utf8_bin NOT NULL,
  `vm` enum('evm','x86') CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
  `type` enum('dgp','qrc20','qrc721') CHARACTER SET utf8 COLLATE utf8_general_ci DEFAULT NULL,
  `bytecode_sha256sum` binary(32) NOT NULL,
  `description` text COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `contract_code` (
  `sha256sum` binary(32) NOT NULL,
  `code` mediumblob NOT NULL,
  `source` longtext COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `contract_spend` (
  `source_id` bigint(20) UNSIGNED NOT NULL,
  `dest_id` bigint(20) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `contract_tag` (
  `_id` bigint(20) NOT NULL,
  `contract_address` binary(20) NOT NULL,
  `tag` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `evm_event_abi` (
  `_id` int(10) UNSIGNED NOT NULL,
  `id` binary(32) NOT NULL,
  `name` varchar(255) CHARACTER SET utf8 NOT NULL,
  `inputs` json NOT NULL,
  `anonymous` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `evm_function_abi` (
  `_id` int(10) UNSIGNED NOT NULL,
  `id` binary(4) NOT NULL,
  `type` enum('function','constructor','fallback','') CHARACTER SET utf8 NOT NULL,
  `name` varchar(255) CHARACTER SET utf8 NOT NULL,
  `inputs` json NOT NULL,
  `outputs` json NOT NULL,
  `state_mutability` enum('pure','view','nonpayable','payable') CHARACTER SET utf8 NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `evm_receipt` (
  `_id` bigint(20) UNSIGNED NOT NULL,
  `transaction_id` bigint(20) UNSIGNED NOT NULL,
  `output_index` int(10) UNSIGNED NOT NULL,
  `block_height` int(10) UNSIGNED NOT NULL,
  `index_in_block` int(10) UNSIGNED NOT NULL,
  `sender_type` tinyint(3) UNSIGNED NOT NULL,
  `sender_data` varbinary(32) NOT NULL,
  `gas_used` int(10) UNSIGNED NOT NULL,
  `contract_address` binary(20) NOT NULL,
  `excepted` varchar(32) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
  `excepted_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

CREATE TABLE `evm_receipt_log` (
  `_id` bigint(20) UNSIGNED NOT NULL,
  `receipt_id` bigint(20) UNSIGNED NOT NULL,
  `log_index` int(10) UNSIGNED NOT NULL,
  `address` binary(20) NOT NULL,
  `topic1` varbinary(32) DEFAULT NULL,
  `topic2` varbinary(32) DEFAULT NULL,
  `topic3` varbinary(32) DEFAULT NULL,
  `topic4` varbinary(32) DEFAULT NULL,
  `data` blob NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `evm_receipt_mapping` (
  `transaction_id` bigint(20) UNSIGNED NOT NULL,
  `output_index` int(10) UNSIGNED NOT NULL,
  `index_in_block` int(10) UNSIGNED NOT NULL,
  `gas_used` int(10) UNSIGNED NOT NULL,
  `contract_address` binary(20) NOT NULL,
  `excepted` varchar(32) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
  `excepted_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8 ROW_FORMAT=COMPACT;

CREATE TABLE `gas_refund` (
  `transaction_id` bigint(20) UNSIGNED NOT NULL,
  `output_index` int(10) UNSIGNED NOT NULL,
  `refund_id` bigint(20) UNSIGNED NOT NULL,
  `refund_index` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `header` (
  `hash` binary(32) NOT NULL,
  `height` int(10) UNSIGNED NOT NULL,
  `version` int(11) NOT NULL,
  `prev_hash` binary(32) NOT NULL,
  `merkle_root` binary(32) NOT NULL,
  `timestamp` int(10) UNSIGNED NOT NULL,
  `bits` int(10) UNSIGNED NOT NULL,
  `nonce` int(10) UNSIGNED NOT NULL,
  `hash_state_root` binary(32) NOT NULL,
  `hash_utxo_root` binary(32) NOT NULL,
  `stake_prev_transaction_id` binary(32) NOT NULL,
  `stake_output_index` int(10) UNSIGNED NOT NULL,
  `signature` blob NOT NULL,
  `chainwork` binary(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `qrc20` (
  `contract_address` binary(20) NOT NULL,
  `name` blob NOT NULL,
  `symbol` blob NOT NULL,
  `decimals` tinyint(3) UNSIGNED NOT NULL,
  `total_supply` binary(32) NOT NULL,
  `version` blob
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `qrc20_balance` (
  `contract_address` binary(20) NOT NULL,
  `address` binary(20) NOT NULL,
  `balance` binary(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `qrc721` (
  `contract_address` binary(20) NOT NULL,
  `name` blob NOT NULL,
  `symbol` blob NOT NULL,
  `total_supply` binary(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `qrc721_token` (
  `contract_address` binary(20) NOT NULL,
  `token_id` binary(32) NOT NULL,
  `holder` binary(20) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `rich_list` (
  `address_id` bigint(20) UNSIGNED NOT NULL,
  `balance` bigint(20) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `tip` (
  `service` varchar(32) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
  `height` int(10) UNSIGNED NOT NULL,
  `hash` binary(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `transaction` (
  `_id` bigint(20) UNSIGNED NOT NULL,
  `id` binary(32) NOT NULL,
  `hash` binary(32) NOT NULL,
  `version` int(11) NOT NULL,
  `flag` tinyint(3) UNSIGNED NOT NULL,
  `lock_time` int(10) UNSIGNED NOT NULL,
  `block_height` int(10) UNSIGNED NOT NULL,
  `index_in_block` int(10) UNSIGNED NOT NULL,
  `size` int(10) UNSIGNED NOT NULL,
  `weight` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `transaction_input` (
  `transaction_id` bigint(20) UNSIGNED NOT NULL,
  `input_index` int(10) UNSIGNED NOT NULL,
  `scriptsig` mediumblob NOT NULL,
  `sequence` int(10) UNSIGNED NOT NULL,
  `block_height` int(10) UNSIGNED NOT NULL,
  `value` bigint(20) NOT NULL,
  `address_id` bigint(20) UNSIGNED NOT NULL,
  `output_id` bigint(20) UNSIGNED NOT NULL,
  `output_index` int(10) UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `transaction_output` (
  `transaction_id` bigint(20) UNSIGNED NOT NULL,
  `output_index` int(10) UNSIGNED NOT NULL,
  `scriptpubkey` mediumblob NOT NULL,
  `block_height` int(10) UNSIGNED NOT NULL,
  `value` bigint(20) NOT NULL,
  `address_id` bigint(20) UNSIGNED NOT NULL,
  `is_stake` tinyint(1) NOT NULL,
  `input_id` bigint(20) UNSIGNED NOT NULL,
  `input_index` int(10) UNSIGNED NOT NULL,
  `input_height` int(10) UNSIGNED DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;

CREATE TABLE `transaction_output_mapping` (
  `_id` char(32) CHARACTER SET utf8 COLLATE utf8_general_ci NOT NULL,
  `input_transaction_id` binary(32) NOT NULL,
  `input_index` int(10) UNSIGNED NOT NULL,
  `output_transaction_id` binary(32) NOT NULL,
  `output_index` int(10) UNSIGNED NOT NULL
) ENGINE=MEMORY DEFAULT CHARSET=utf8;

CREATE TABLE `witness` (
  `transaction_id` binary(32) NOT NULL,
  `input_index` int(10) UNSIGNED NOT NULL,
  `witness_index` int(10) UNSIGNED NOT NULL,
  `script` blob NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci ROW_FORMAT=COMPACT;


ALTER TABLE `address`
  ADD PRIMARY KEY (`_id`),
  ADD UNIQUE KEY `address` (`data`,`type`),
  ADD UNIQUE KEY `string` (`string`) USING BTREE,
  ADD KEY `create_height` (`create_height`);

ALTER TABLE `balance_change`
  ADD PRIMARY KEY (`transaction_id`,`address_id`) USING BTREE,
  ADD UNIQUE KEY `address` (`address_id`,`block_height`,`index_in_block`,`transaction_id`,`value`);

ALTER TABLE `block`
  ADD PRIMARY KEY (`height`),
  ADD UNIQUE KEY `hash` (`hash`),
  ADD KEY `miner` (`miner_id`);

ALTER TABLE `contract`
  ADD PRIMARY KEY (`address`) USING BTREE,
  ADD UNIQUE KEY `address` (`address_string`) USING BTREE,
  ADD KEY `bytecode` (`bytecode_sha256sum`) USING BTREE;

ALTER TABLE `contract_code`
  ADD PRIMARY KEY (`sha256sum`);

ALTER TABLE `contract_spend`
  ADD PRIMARY KEY (`source_id`) USING BTREE,
  ADD KEY `dest` (`dest_id`) USING BTREE;

ALTER TABLE `contract_tag`
  ADD PRIMARY KEY (`_id`),
  ADD KEY `contract` (`contract_address`),
  ADD KEY `tag` (`tag`);

ALTER TABLE `evm_receipt`
  ADD PRIMARY KEY (`_id`),
  ADD UNIQUE KEY `output` (`transaction_id`,`output_index`) USING BTREE,
  ADD UNIQUE KEY `block` (`block_height`,`index_in_block`,`transaction_id`,`output_index`) USING BTREE,
  ADD KEY `contract` (`contract_address`),
  ADD KEY `sender` (`sender_data`,`sender_type`) USING BTREE;

ALTER TABLE `evm_receipt_log`
  ADD PRIMARY KEY (`_id`),
  ADD UNIQUE KEY `log` (`receipt_id`,`log_index`) USING BTREE,
  ADD KEY `contract` (`address`),
  ADD KEY `topic1` (`topic1`),
  ADD KEY `topic2` (`topic2`),
  ADD KEY `topic3` (`topic3`),
  ADD KEY `topic4` (`topic4`);

ALTER TABLE `evm_receipt_mapping`
  ADD PRIMARY KEY (`transaction_id`,`output_index`) USING BTREE;

ALTER TABLE `gas_refund`
  ADD PRIMARY KEY (`transaction_id`,`output_index`) USING BTREE,
  ADD UNIQUE KEY `refund` (`refund_id`,`refund_index`);

ALTER TABLE `header`
  ADD PRIMARY KEY (`height`),
  ADD UNIQUE KEY `hash` (`hash`),
  ADD KEY `timestamp` (`timestamp`);

ALTER TABLE `qrc20`
  ADD PRIMARY KEY (`contract_address`);

ALTER TABLE `qrc20_balance`
  ADD PRIMARY KEY (`contract_address`,`address`),
  ADD KEY `rich_list` (`contract_address`, `balance` DESC) USING BTREE,
  ADD KEY `address` (`address`) USING BTREE;

ALTER TABLE `qrc721`
  ADD PRIMARY KEY (`contract_address`);

ALTER TABLE `qrc721_token`
  ADD PRIMARY KEY (`contract_address`,`token_id`),
  ADD KEY `owner` (`holder`);

ALTER TABLE `rich_list`
  ADD PRIMARY KEY (`address_id`) USING BTREE,
  ADD KEY `balance` (`balance` DESC);

ALTER TABLE `tip`
  ADD PRIMARY KEY (`service`);

ALTER TABLE `transaction`
  ADD PRIMARY KEY (`_id`),
  ADD UNIQUE KEY `id` (`id`) USING BTREE,
  ADD UNIQUE KEY `block` (`block_height`,`index_in_block`,`_id`) USING BTREE;

ALTER TABLE `transaction_input`
  ADD PRIMARY KEY (`transaction_id`,`input_index`) USING BTREE,
  ADD KEY `address` (`address_id`) USING BTREE,
  ADD KEY `height` (`block_height`) USING BTREE;

ALTER TABLE `transaction_output`
  ADD PRIMARY KEY (`transaction_id`,`output_index`) USING BTREE,
  ADD KEY `height` (`block_height`) USING BTREE,
  ADD KEY `address` (`address_id`,`input_height`,`block_height`,`value`) USING BTREE;

ALTER TABLE `transaction_output_mapping`
  ADD KEY `id` (`_id`);

ALTER TABLE `witness`
  ADD PRIMARY KEY (`transaction_id`,`input_index`,`witness_index`) USING BTREE;


ALTER TABLE `address`
  MODIFY `_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `contract_tag`
  MODIFY `_id` bigint(20) NOT NULL AUTO_INCREMENT;

ALTER TABLE `evm_event_abi`
  MODIFY `_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `evm_function_abi`
  MODIFY `_id` int(10) UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `evm_receipt`
  MODIFY `_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `evm_receipt_log`
  MODIFY `_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;

ALTER TABLE `transaction`
  MODIFY `_id` bigint(20) UNSIGNED NOT NULL AUTO_INCREMENT;
