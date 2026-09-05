-- MySQL dump 10.13  Distrib 8.0.43, for Win64 (x86_64)
--
-- Host: localhost    Database: eduplay
-- ------------------------------------------------------
-- Server version	8.0.43

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `eduplay`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `eduplay` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `eduplay`;

--
-- Table structure for table `activation_code`
--

DROP TABLE IF EXISTS `activation_code`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `activation_code` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `game_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'UNUSED',
  `used_by_user_id` bigint DEFAULT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`),
  KEY `fk_activation_code_user` (`used_by_user_id`),
  CONSTRAINT `fk_activation_code_user` FOREIGN KEY (`used_by_user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `activation_code`
--

LOCK TABLES `activation_code` WRITE;
/*!40000 ALTER TABLE `activation_code` DISABLE KEYS */;
INSERT INTO `activation_code` VALUES (1,'province_puzzle','PROVINCE-PUZZLE-2026','UNUSED',NULL,NULL,'2026-09-03 07:01:02'),(2,'province_puzzle','MYSQL-30E0BDE3-568','USED',1,'2026-09-02 23:01:11','2026-09-02 23:01:10'),(3,'province_puzzle','MYSQL-32A73126-485','USED',2,'2026-09-02 23:40:53','2026-09-02 23:40:53'),(4,'province_puzzle','MYSQL-1F8967ED-F65','USED',3,'2026-09-02 23:46:52','2026-09-02 23:46:52'),(5,'province_puzzle','MYSQL-228BEC38-EE5','USED',4,'2026-09-03 00:23:21','2026-09-03 00:23:21'),(6,'province_puzzle','MYSQL-F31E2749-463','USED',6,'2026-09-03 03:20:37','2026-09-03 03:20:37'),(7,'province_puzzle','MYSQL-BF0F3609-632','USED',7,'2026-09-03 19:00:42','2026-09-03 19:00:42');
/*!40000 ALTER TABLE `activation_code` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `app_user`
--

DROP TABLE IF EXISTS `app_user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_user` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `nickname` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'GUEST',
  `created_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'STUDENT',
  `student_no` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `class_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `uk_app_user_student_no` (`student_no`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `app_user`
--

LOCK TABLES `app_user` WRITE;
/*!40000 ALTER TABLE `app_user` DISABLE KEYS */;
INSERT INTO `app_user` VALUES (1,'mysql_de12b327','MySQL测试','LOCAL','2026-09-02 23:01:10','2026-09-02 23:01:10','$2a$10$0ht5uwTmw9n0QUSCmq4EVO08aJvI4DdiD6QRMvp/fULOlepgmaoxW','TEACHER',NULL,NULL,'ACTIVE'),(2,'mysql_951556cf','MySQL测试','LOCAL','2026-09-02 23:40:53','2026-09-02 23:40:53','$2a$10$TcErogPx/qbWcSOjyl0m1OYr31DWfYU1FZhjHWXVeiMWNlL3bqWOi','TEACHER',NULL,NULL,'ACTIVE'),(3,'mysql_04eb6ae3','MySQL测试','LOCAL','2026-09-02 23:46:52','2026-09-02 23:46:52','$2a$10$rXKPcy/036C8khf4T9yTUugVUpKS4RrNUp36/y7t59e.yXtEQu8Vq','TEACHER',NULL,NULL,'ACTIVE'),(4,'mysql_cc953dc1','MySQL测试','LOCAL','2026-09-03 00:23:21','2026-09-03 00:23:21','$2a$10$BHUlB3ukQLWoj8es0WcTt.ULQDdVmMW6PV8RYn.1ij.rjEknRhwde','TEACHER',NULL,NULL,'ACTIVE'),(5,'admin','超级管理员','ADMIN','2026-09-03 03:20:36','2026-09-03 03:20:36','$2a$10$ENWuFnwi4k8TNhGNBgNdKeWww3DHdGTxFX6EsWJsQe/lMHGK9n8Zi','SUPER_ADMIN',NULL,NULL,'ACTIVE'),(6,'mysql_3fa01e98','MySQL测试','LOCAL','2026-09-03 03:20:37','2026-09-03 03:20:37','$2a$10$ZySIBS3jheKXLBGPFJioR.CJ1OkV3DYcWCdWV.BBwDjQ7wkZcMezW','TEACHER',NULL,NULL,'ACTIVE'),(7,'mysql_b7c2bb98','MySQL测试','LOCAL','2026-09-03 19:00:42','2026-09-03 19:00:42','$2a$10$jHk1uePVT9XFtk1xdWdMtuHy/0xlSpWmwTi9uhEbw/ow.y2UTJxze','TEACHER',NULL,NULL,'ACTIVE');
/*!40000 ALTER TABLE `app_user` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `flyway_schema_history`
--

DROP TABLE IF EXISTS `flyway_schema_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `flyway_schema_history` (
  `installed_rank` int NOT NULL,
  `version` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `script` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum` int DEFAULT NULL,
  `installed_by` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `installed_on` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_time` int NOT NULL,
  `success` tinyint(1) NOT NULL,
  PRIMARY KEY (`installed_rank`),
  KEY `flyway_schema_history_s_idx` (`success`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `flyway_schema_history`
--

LOCK TABLES `flyway_schema_history` WRITE;
/*!40000 ALTER TABLE `flyway_schema_history` DISABLE KEYS */;
INSERT INTO `flyway_schema_history` VALUES (1,'1','init','SQL','V1__init.sql',122702585,'root','2026-09-03 07:01:02',113,1),(2,'2','local accounts','SQL','V2__local_accounts.sql',-1661555021,'root','2026-09-03 07:01:02',188,1),(3,'3','student roster','SQL','V3__student_roster.sql',2093224596,'root','2026-09-03 07:01:02',41,1),(4,'4','game install','SQL','V4__game_install.sql',-1899128680,'root','2026-09-03 07:01:02',25,1),(5,'5','plugin package and entitlement','SQL','V5__plugin_package_and_entitlement.sql',-93943658,'root','2026-09-03 07:01:02',65,1),(6,'6','drop teacher points','SQL','V6__drop_teacher_points.sql',-473435516,'root','2026-09-03 07:40:49',35,1),(7,'7','drop game session','SQL','V7__drop_game_session.sql',-1772011862,'root','2026-09-03 07:46:47',23,1),(8,'8','student class no','SQL','V8__student_class_no.sql',1493351675,'root','2026-09-03 08:23:14',49,1),(9,'9','admin accounts','SQL','V9__admin_accounts.sql',-1565236908,'root','2026-09-03 11:20:33',54,1);
/*!40000 ALTER TABLE `flyway_schema_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_package`
--

DROP TABLE IF EXISTS `game_package`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_package` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `game_id` bigint NOT NULL,
  `version` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `package_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sha256` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PUBLISHED',
  `created_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_game_package_game_version` (`game_id`,`version`),
  CONSTRAINT `fk_game_package_game` FOREIGN KEY (`game_id`) REFERENCES `game_product` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_package`
--

LOCK TABLES `game_package` WRITE;
/*!40000 ALTER TABLE `game_package` DISABLE KEYS */;
INSERT INTO `game_package` VALUES (1,1,'0.1.0','province_puzzle-0.1.0.zip','c7948c2ec23d4ab50e5f4fee81ca90e66060eb9b3880c3453bcfccab9c9085ee',62519,'PUBLISHED','2026-09-03 07:01:02');
/*!40000 ALTER TABLE `game_package` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_product`
--

DROP TABLE IF EXISTS `game_product`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_product` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `game_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price_cents` int NOT NULL DEFAULT '0',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `version` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `entry` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `game_code` (`game_code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_product`
--

LOCK TABLES `game_product` WRITE;
/*!40000 ALTER TABLE `game_product` DISABLE KEYS */;
INSERT INTO `game_product` VALUES (1,'province_puzzle','行政区拼图','拖动省级行政区到地图上的正确位置，认识中国省级行政区。',NULL,990,'ACTIVE','0.1.0','province_puzzle','2026-09-03 07:01:02','2026-09-03 07:01:02');
/*!40000 ALTER TABLE `game_product` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `local_session`
--

DROP TABLE IF EXISTS `local_session`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `local_session` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token` (`token`),
  KEY `fk_local_session_user` (`user_id`),
  CONSTRAINT `fk_local_session_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `local_session`
--

LOCK TABLES `local_session` WRITE;
/*!40000 ALTER TABLE `local_session` DISABLE KEYS */;
INSERT INTO `local_session` VALUES (1,1,'ef9f24d8-a1fb-428d-9a93-47e3b952c9e4','2026-10-02 23:01:10','2026-09-02 23:01:10'),(2,2,'43713225-9737-436f-b915-44a472d8ee29','2026-10-02 23:40:53','2026-09-02 23:40:53'),(3,3,'7e0b746b-16fb-4c1d-8cbc-9759624a577c','2026-10-02 23:46:52','2026-09-02 23:46:52'),(4,4,'ea7a22f4-022d-4726-9c92-3b0fd0894d1b','2026-10-03 00:23:21','2026-09-03 00:23:21'),(5,6,'f8cbbb68-e292-498d-adef-c0501eaf5f53','2026-10-03 03:20:37','2026-09-03 03:20:37'),(6,7,'b20dc3d7-e45b-403d-8fbe-1f889f8ec6f0','2026-10-03 19:00:42','2026-09-03 19:00:42');
/*!40000 ALTER TABLE `local_session` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `student`
--

DROP TABLE IF EXISTS `student`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `student` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `teacher_id` bigint NOT NULL,
  `student_no` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `class_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '未分班',
  `total_points` int NOT NULL DEFAULT '0',
  `version` bigint NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_student_teacher_class_no` (`teacher_id`,`class_name`,`student_no`),
  KEY `idx_student_teacher_id` (`teacher_id`),
  CONSTRAINT `fk_student_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `student`
--

LOCK TABLES `student` WRITE;
/*!40000 ALTER TABLE `student` DISABLE KEYS */;
/*!40000 ALTER TABLE `student` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `student_points_ledger`
--

DROP TABLE IF EXISTS `student_points_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `student_points_ledger` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `student_id` bigint NOT NULL,
  `teacher_id` bigint NOT NULL,
  `change_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` int NOT NULL,
  `balance_after` int NOT NULL,
  `biz_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `biz_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `idempotency_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idempotency_key` (`idempotency_key`),
  KEY `fk_student_ledger_student` (`student_id`),
  KEY `fk_student_ledger_teacher` (`teacher_id`),
  CONSTRAINT `fk_student_ledger_student` FOREIGN KEY (`student_id`) REFERENCES `student` (`id`),
  CONSTRAINT `fk_student_ledger_teacher` FOREIGN KEY (`teacher_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `student_points_ledger`
--

LOCK TABLES `student_points_ledger` WRITE;
/*!40000 ALTER TABLE `student_points_ledger` DISABLE KEYS */;
/*!40000 ALTER TABLE `student_points_ledger` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_entitlement`
--

DROP TABLE IF EXISTS `user_entitlement`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_entitlement` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `game_id` bigint NOT NULL,
  `source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ACTIVE',
  `granted_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_entitlement` (`user_id`,`game_id`),
  KEY `fk_user_entitlement_game` (`game_id`),
  CONSTRAINT `fk_user_entitlement_game` FOREIGN KEY (`game_id`) REFERENCES `game_product` (`id`),
  CONSTRAINT `fk_user_entitlement_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_entitlement`
--

LOCK TABLES `user_entitlement` WRITE;
/*!40000 ALTER TABLE `user_entitlement` DISABLE KEYS */;
INSERT INTO `user_entitlement` VALUES (1,1,1,'ACTIVATION_CODE','ACTIVE','2026-09-02 23:01:11','2026-09-02 23:01:11'),(2,2,1,'ACTIVATION_CODE','ACTIVE','2026-09-02 23:40:53','2026-09-02 23:40:53'),(3,3,1,'ACTIVATION_CODE','ACTIVE','2026-09-02 23:46:52','2026-09-02 23:46:52'),(4,4,1,'ACTIVATION_CODE','ACTIVE','2026-09-03 00:23:21','2026-09-03 00:23:21'),(5,6,1,'ACTIVATION_CODE','ACTIVE','2026-09-03 03:20:37','2026-09-03 03:20:37'),(6,7,1,'ACTIVATION_CODE','ACTIVE','2026-09-03 19:00:42','2026-09-03 19:00:42');
/*!40000 ALTER TABLE `user_entitlement` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_game_install`
--

DROP TABLE IF EXISTS `user_game_install`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_game_install` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `user_id` bigint NOT NULL,
  `game_id` bigint NOT NULL,
  `installed_version` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `installed_at` timestamp NOT NULL,
  `updated_at` timestamp NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_game_install` (`user_id`,`game_id`),
  KEY `fk_user_game_install_game` (`game_id`),
  CONSTRAINT `fk_user_game_install_game` FOREIGN KEY (`game_id`) REFERENCES `game_product` (`id`),
  CONSTRAINT `fk_user_game_install_user` FOREIGN KEY (`user_id`) REFERENCES `app_user` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_game_install`
--

LOCK TABLES `user_game_install` WRITE;
/*!40000 ALTER TABLE `user_game_install` DISABLE KEYS */;
INSERT INTO `user_game_install` VALUES (1,1,1,'0.1.0','INSTALLED','2026-09-02 23:01:11','2026-09-02 23:01:11'),(2,2,1,'0.1.0','INSTALLED','2026-09-02 23:40:53','2026-09-02 23:40:53'),(3,3,1,'0.1.0','INSTALLED','2026-09-02 23:46:52','2026-09-02 23:46:52'),(4,4,1,'0.1.0','INSTALLED','2026-09-03 00:23:22','2026-09-03 00:23:22'),(5,6,1,'0.1.0','INSTALLED','2026-09-03 03:20:37','2026-09-03 03:20:37'),(6,7,1,'0.1.0','INSTALLED','2026-09-03 19:00:43','2026-09-03 19:00:43');
/*!40000 ALTER TABLE `user_game_install` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-09-05 10:21:47
